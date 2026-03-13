import * as vscode from 'vscode';
import * as path from 'path';
import * as storage from './storage';

let workspaceRoot: string | undefined;
let currentDate: string = storage.getTodayDateString();
let currentSession: storage.SessionData;
let currentBranch: string = '_default';

let activeFile: string | undefined;
let activeFileStartTime: number | undefined;
let isIdle = false;

const stopwatchPerFile = new Map<string, number>();
const stopwatchRunningFiles = new Set<string>();
let stopwatchInterval: NodeJS.Timeout | undefined;
let autoSaveInterval: NodeJS.Timeout | undefined;
let dashboardInterval: NodeJS.Timeout | undefined;
let idleTimeout: NodeJS.Timeout | undefined;

let pomodoroActive = false;
let pomodoroRemaining = 0;
let pomodoroInterval: NodeJS.Timeout | undefined;

let timerProvider: TimerViewProvider;
let dashboardProvider: DashboardViewProvider;

function cfg<T>(key: string, fallback: T): T {
    return vscode.workspace.getConfiguration('chronotab').get<T>(key, fallback);
}

export function activate(context: vscode.ExtensionContext) {
    const wsFolders = vscode.workspace.workspaceFolders;
    if (wsFolders && wsFolders.length > 0) {
        workspaceRoot = wsFolders[0].uri.fsPath;
        storage.ensureStorageDir(workspaceRoot);
        currentSession = storage.loadSession(workspaceRoot, currentDate);
        if (cfg('trackGitBranch', true)) {
            currentBranch = storage.getCurrentBranch(workspaceRoot);
        }
    }

    timerProvider = new TimerViewProvider();
    dashboardProvider = new DashboardViewProvider();

    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(TimerViewProvider.viewType, timerProvider),
        vscode.window.registerWebviewViewProvider(DashboardViewProvider.viewType, dashboardProvider)
    );

    context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(onEditorChange));
    context.subscriptions.push(vscode.window.onDidChangeWindowState(onWindowStateChange));
    context.subscriptions.push(vscode.workspace.onDidChangeTextDocument(resetIdleTimer));
    context.subscriptions.push(vscode.window.onDidChangeTextEditorSelection(resetIdleTimer));
    context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(e => {
        if (e.affectsConfiguration('chronotab')) { resetIdleTimer(); }
    }));

    autoSaveInterval = setInterval(flushSession, 30_000);
    dashboardInterval = setInterval(() => { syncTracking(); dashboardProvider.pushData(); }, 5_000);

    const editor = vscode.window.activeTextEditor;
    if (editor && editor.document.uri.scheme === 'file' && !editor.document.fileName.includes('.chronotab')) {
        beginTracking(editor.document.fileName);
    } else {
        setTimeout(() => timerProvider.pushTimer({ file: 'No file', stopwatch: '00:00', running: false, idle: false, pomodoro: false, pomodoroTime: '' }), 800);
    }
}

// ─── Idle Detection ──────────────────────────

function onWindowStateChange(state: vscode.WindowState) {
    if (!state.focused) {
        goIdle();
    } else {
        resumeFromIdle();
    }
}

function resetIdleTimer() {
    if (isIdle) { resumeFromIdle(); }
    if (idleTimeout) { clearTimeout(idleTimeout); }
    const mins = cfg('idleTimeoutMinutes', 5);
    idleTimeout = setTimeout(goIdle, mins * 60_000);
}

function goIdle() {
    if (isIdle) { return; }
    isIdle = true;
    syncTracking();
    activeFileStartTime = undefined;
    timerProvider.pushTimer({ file: activeFile || 'No file', stopwatch: formatTime(stopwatchPerFile.get(activeFile || '') || 0), running: false, idle: true, pomodoro: pomodoroActive, pomodoroTime: pomodoroActive ? formatTime(pomodoroRemaining) : '' });
    if (pomodoroInterval) { clearInterval(pomodoroInterval); pomodoroInterval = undefined; }
    if (stopwatchInterval) { clearInterval(stopwatchInterval); stopwatchInterval = undefined; }
}

function resumeFromIdle() {
    if (!isIdle) { return; }
    isIdle = false;
    if (activeFile) {
        activeFileStartTime = Date.now();
        const wasStarted = stopwatchRunningFiles.has(activeFile);
        if (wasStarted) { resumeStopwatchInterval(activeFile); }
        if (pomodoroActive && !pomodoroInterval) { resumePomodoroInterval(); }
        timerProvider.pushTimer({ file: activeFile, stopwatch: formatTime(stopwatchPerFile.get(activeFile) || 0), running: wasStarted, idle: false, pomodoro: pomodoroActive, pomodoroTime: pomodoroActive ? formatTime(pomodoroRemaining) : '' });
    }
    resetIdleTimer();
}

// ─── Background Tracking ─────────────────────

function onEditorChange() {
    syncTracking();
    activeFileStartTime = undefined;

    if (stopwatchInterval) { clearInterval(stopwatchInterval); stopwatchInterval = undefined; }

    const editor = vscode.window.activeTextEditor;
    if (editor && editor.document.uri.scheme === 'file') {
        if (editor.document.fileName.includes('.chronotab')) {
            activeFile = undefined;
            pushTimerState();
            return;
        }
        if (workspaceRoot && cfg('trackGitBranch', true)) {
            currentBranch = storage.getCurrentBranch(workspaceRoot);
        }
        beginTracking(editor.document.fileName);
    } else {
        activeFile = undefined;
        pushTimerState();
    }
}

function beginTracking(fullPath: string) {
    const filename = path.basename(fullPath);
    activeFile = filename;
    activeFileStartTime = Date.now();
    resetIdleTimer();

    const secs = stopwatchPerFile.get(filename) || 0;
    const wasStarted = stopwatchRunningFiles.has(filename);
    if (wasStarted && !isIdle) { resumeStopwatchInterval(filename); }

    timerProvider.pushTimer({ file: filename, stopwatch: formatTime(secs), running: wasStarted, idle: isIdle, pomodoro: pomodoroActive, pomodoroTime: pomodoroActive ? formatTime(pomodoroRemaining) : '' });
}

function syncTracking() {
    if (activeFile && activeFileStartTime !== undefined) {
        const now = Date.now();
        const elapsed = Math.floor((now - activeFileStartTime) / 1000);
        if (elapsed > 0) {
            accumulateFile(activeFile, elapsed);
            activeFileStartTime = now;
        }
    }
}

function pauseTracking() {
    syncTracking();
    activeFileStartTime = undefined;
}

function accumulateFile(filename: string, seconds: number) {
    if (!workspaceRoot || seconds <= 0) { return; }
    const now = new Date().toISOString();
    if (!currentSession.branches[currentBranch]) {
        currentSession.branches[currentBranch] = {};
    }
    const branchFiles = currentSession.branches[currentBranch];
    if (!branchFiles[filename]) {
        branchFiles[filename] = { seconds: 0, lastActive: now };
    }
    branchFiles[filename].seconds += seconds;
    branchFiles[filename].lastActive = now;
    currentSession.totalSeconds += seconds;
}

function flushSession() {
    syncTracking();
    if (workspaceRoot) {
        currentDate = storage.getTodayDateString();
        if (currentSession.date !== currentDate) {
            currentSession = storage.loadSession(workspaceRoot, currentDate);
        }
        storage.saveSession(workspaceRoot, currentSession);
    }
}

// ─── Stopwatch ───────────────────────────────

function startStopwatch() {
    if (!activeFile || stopwatchRunningFiles.has(activeFile) || isIdle) { return; }
    const filename = activeFile;
    stopwatchRunningFiles.add(filename);
    resumeStopwatchInterval(filename);
    timerProvider.pushTimer({ file: filename, stopwatch: formatTime(stopwatchPerFile.get(filename) || 0), running: true, idle: false, pomodoro: pomodoroActive, pomodoroTime: pomodoroActive ? formatTime(pomodoroRemaining) : '' });
}

function resumeStopwatchInterval(filename: string) {
    if (stopwatchInterval) { clearInterval(stopwatchInterval); }
    stopwatchInterval = setInterval(() => {
        const s = (stopwatchPerFile.get(filename) || 0) + 1;
        stopwatchPerFile.set(filename, s);
        timerProvider.pushTimer({ file: filename, stopwatch: formatTime(s), running: true, idle: false, pomodoro: pomodoroActive, pomodoroTime: pomodoroActive ? formatTime(pomodoroRemaining) : '' });
    }, 1000);
}

function pauseStopwatch() {
    if (stopwatchInterval) { clearInterval(stopwatchInterval); stopwatchInterval = undefined; }
    if (activeFile) {
        stopwatchRunningFiles.delete(activeFile);
        pushTimerState();
    }
}

function resetStopwatch() {
    pauseStopwatch();
    if (activeFile) {
        stopwatchPerFile.set(activeFile, 0);
        pushTimerState();
    }
}

// ─── Pomodoro ────────────────────────────────

function startPomodoro(minutes?: number) {
    const dur = minutes || cfg('pomodoroMinutes', 25);
    pomodoroActive = true;
    pomodoroRemaining = dur * 60;
    if (pomodoroInterval) { clearInterval(pomodoroInterval); }
    resumePomodoroInterval();
    pushTimerState();
}

function resumePomodoroInterval() {
    pomodoroInterval = setInterval(() => {
        if (isIdle) { return; }
        pomodoroRemaining--;
        if (pomodoroRemaining <= 0) {
            pomodoroRemaining = 0;
            stopPomodoro();
            vscode.window.showInformationMessage('ChronoTab: Pomodoro complete! Time for a break.');
            return;
        }
        pushTimerState();
    }, 1000);
}

function stopPomodoro() {
    pomodoroActive = false;
    pomodoroRemaining = 0;
    if (pomodoroInterval) { clearInterval(pomodoroInterval); pomodoroInterval = undefined; }
    pushTimerState();
}

// ─── Helpers ─────────────────────────────────

function pushTimerState() {
    const file = activeFile || 'No file';
    const secs = file !== 'No file' ? (stopwatchPerFile.get(file) || 0) : 0;
    const running = file !== 'No file' && stopwatchRunningFiles.has(file);
    timerProvider.pushTimer({ file, stopwatch: formatTime(secs), running, idle: isIdle, pomodoro: pomodoroActive, pomodoroTime: pomodoroActive ? formatTime(pomodoroRemaining) : '' });
}

function formatTime(seconds: number): string {
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    const pad = (n: number) => n.toString().padStart(2, '0');
    return hrs > 0 ? `${pad(hrs)}:${pad(mins)}:${pad(secs)}` : `${pad(mins)}:${pad(secs)}`;
}

function fmtDuration(seconds: number): string {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    const pad = (n: number) => n.toString().padStart(2, '0');
    if (h > 0) { return `${h}h ${pad(m)}m`; }
    if (m > 0) { return `${m}m ${pad(s)}s`; }
    return `${s}s`;
}

export function deactivate() {
    pauseTracking();
    flushSession();
    if (autoSaveInterval) { clearInterval(autoSaveInterval); }
    if (stopwatchInterval) { clearInterval(stopwatchInterval); }
    if (dashboardInterval) { clearInterval(dashboardInterval); }
    if (pomodoroInterval) { clearInterval(pomodoroInterval); }
    if (idleTimeout) { clearTimeout(idleTimeout); }
}

// ─── Timer View ──────────────────────────────

interface TimerState {
    file: string; stopwatch: string; running: boolean; idle: boolean;
    pomodoro: boolean; pomodoroTime: string;
}

class TimerViewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'chronotab.timerView';
    private _view?: vscode.WebviewView;

    public resolveWebviewView(wv: vscode.WebviewView) {
        this._view = wv;
        wv.webview.options = { enableScripts: true };
        wv.webview.html = TIMER_HTML;
        wv.webview.onDidReceiveMessage(msg => {
            switch (msg.command) {
                case 'startStopwatch': startStopwatch(); break;
                case 'pauseStopwatch': pauseStopwatch(); break;
                case 'resetStopwatch': resetStopwatch(); break;
                case 'startPomodoro': startPomodoro(msg.minutes); break;
                case 'stopPomodoro': stopPomodoro(); break;
            }
        });
        setTimeout(() => pushTimerState(), 600);
    }

    public pushTimer(state: TimerState) {
        this._view?.webview.postMessage({ command: 'update', ...state });
    }
}

// ─── Dashboard View ──────────────────────────

class DashboardViewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'chronotab.dashboardView';
    private _view?: vscode.WebviewView;
    private _activeTab = 'today';

    public resolveWebviewView(wv: vscode.WebviewView) {
        this._view = wv;
        wv.webview.options = { enableScripts: true };
        wv.webview.html = DASHBOARD_HTML;
        wv.webview.onDidReceiveMessage(async msg => {
            if (msg.command === 'switchTab') { this._activeTab = msg.tab; this.pushData(); }
            if (msg.command === 'ready') { this.pushData(); }
            if (msg.command === 'exportCsv') { await this.exportCsv(); }
        });
    }

    public pushData() {
        if (!this._view) { return; }
        const sessions = this._loadTab(this._activeTab);
        const agg = storage.aggregateSessions(sessions);
        const projectName = workspaceRoot ? path.basename(workspaceRoot) : 'Project';
        const files = Object.entries(agg.files).sort((a, b) => b[1] - a[1])
            .map(([name, sec]) => ({ name, seconds: sec, formatted: fmtDuration(sec) }));
        const branches = Object.entries(agg.branchTotals).sort((a, b) => b[1] - a[1])
            .map(([name, sec]) => ({ name, seconds: sec, formatted: fmtDuration(sec) }));
        this._view.webview.postMessage({
            command: 'data', tab: this._activeTab, project: projectName,
            totalFormatted: fmtDuration(agg.totalSeconds), files, branches,
            activeBranch: currentBranch, idle: isIdle
        });
    }

    public refresh() { this.pushData(); }

    private async exportCsv() {
        if (!workspaceRoot) { return; }
        const sessions = this._loadTab(this._activeTab);
        const csv = storage.generateCsv(sessions);
        const uri = await vscode.window.showSaveDialog({
            defaultUri: vscode.Uri.file(path.join(workspaceRoot, `chronotab-${this._activeTab}.csv`)),
            filters: { 'CSV Files': ['csv'] }
        });
        if (uri) {
            const fs = require('fs');
            fs.writeFileSync(uri.fsPath, csv, 'utf8');
            vscode.window.showInformationMessage(`ChronoTab: Exported to ${path.basename(uri.fsPath)}`);
        }
    }

    private _loadTab(tab: string): storage.SessionData[] {
        if (!workspaceRoot) { return []; }
        switch (tab) {
            case 'week': return storage.getWeeklySessions(workspaceRoot);
            case 'month': return storage.getMonthlySessions(workspaceRoot);
            case 'all': return storage.loadAllSessions(workspaceRoot);
            default: return [currentSession];
        }
    }
}

// ─── Static HTML: Timer ──────────────────────

const TIMER_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>ChronoTab</title>
<style>
:root { --active: var(--vscode-textLink-activeForeground); --muted: var(--vscode-disabledForeground); --bg: var(--vscode-editorWidget-background); --border: var(--vscode-widget-border); --hover: var(--vscode-toolbar-hoverBackground); --warn: var(--vscode-editorWarning-foreground); }
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: var(--vscode-font-family), system-ui, sans-serif; background: transparent; color: var(--vscode-editor-foreground); padding: 10px; display: flex; align-items: flex-start; justify-content: center; }
.card { background: var(--bg); border: 1px solid var(--border); border-radius: 10px; width: 100%; overflow: hidden; display: flex; flex-direction: column; }
.accent { height: 3px; background: linear-gradient(90deg, var(--active), var(--vscode-terminal-ansiCyan)); transition: background .3s; flex-shrink: 0; }
.accent.idle { background: var(--warn); }
.accent.pomo { background: linear-gradient(90deg, #e74c3c, #e67e22); }
.header { padding: 14px 16px; display: flex; align-items: center; gap: 8px; border-bottom: 1px solid color-mix(in srgb, var(--border) 40%, transparent); flex-shrink: 0; }
.file-icon { width: 18px; height: 18px; flex-shrink: 0; fill: var(--muted); transition: fill .3s; }
.file-icon.active { fill: var(--active); }
.filename { font-size: .85rem; font-weight: 600; color: var(--vscode-descriptionForeground); word-break: break-all; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }

.section { padding: 16px; display: flex; flex-direction: column; align-items: center; gap: 12px; }
.section.pomo-sec { border-top: 1px dashed var(--border); background: color-mix(in srgb, var(--vscode-editor-background) 30%, transparent); padding-top: 14px; }

.time-display { display: flex; flex-direction: column; align-items: center; }
.time-val { font-size: 2.2rem; font-weight: 800; font-variant-numeric: tabular-nums; letter-spacing: -1px; color: var(--muted); transition: color .3s; white-space: nowrap; line-height: 1; margin-bottom: 2px; }
.time-val.running { color: var(--active); animation: pulse 2s ease-in-out infinite; }
.time-val.pomo { color: #e74c3c; animation: pulse 1.5s ease-in-out infinite; }
@keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.65} }
.time-label { font-size: .65rem; text-transform: uppercase; letter-spacing: 1px; color: var(--muted); font-weight: 600; }

.controls { display: flex; gap: 8px; justify-content: center; }
.btn { background: var(--vscode-editor-background); border: 1px solid var(--border); color: var(--vscode-foreground); cursor: pointer; padding: 6px 10px; border-radius: 6px; display: flex; align-items: center; transition: all .15s; font-family: inherit; font-size: .75rem; gap: 6px; }
.btn svg { width: 14px; height: 14px; fill: currentColor; pointer-events: none; }
.btn:hover:not(:disabled) { background: var(--hover); border-color: var(--vscode-focusBorder); }
.btn:active:not(:disabled) { transform: scale(.95); }
.btn:disabled { opacity: .35; cursor: default; }
.btn.pomo-active { border-color: #e74c3c; color: #e74c3c; background: color-mix(in srgb, #e74c3c 10%, transparent); }

.pomo-input-wrap { display: flex; align-items: center; gap: 4px; border: 1px solid var(--border); border-radius: 6px; padding: 2px 6px; background: var(--vscode-editor-background); }
.pomo-input-wrap span { font-size: .7rem; color: var(--muted); }
.pomo-input { width: 35px; background: transparent; border: none; color: var(--vscode-foreground); font-size: .8rem; font-family: inherit; text-align: right; outline: none; font-weight: 600; }
.pomo-input::-webkit-inner-spin-button { opacity: 0; }

.footer { border-top: 1px solid var(--border); padding: 10px 16px; display: flex; align-items: center; gap: 8px; font-size: .7rem; color: var(--muted); background: color-mix(in srgb, var(--vscode-editor-background) 50%, transparent); flex-shrink: 0; }
.dot { width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0; transition: background .3s, box-shadow .3s; }
.dot.active { background: #4ec94e; box-shadow: 0 0 6px #4ec94e88; }
.dot.idle { background: var(--warn); box-shadow: 0 0 6px rgba(255,165,0,.4); }
.dot.off { background: var(--muted); }
</style>
</head>
<body>
<div class="card">
    <div class="accent" id="accent"></div>
    
    <div class="header">
        <svg class="file-icon" id="ficon" viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6zm-1 1.5L18.5 9H13V3.5zM6 20V4h5v6h6v10H6z"/></svg>
        <span class="filename" id="fname">Waiting...</span>
    </div>

    <div class="section" id="sec-sw">
        <div class="time-display">
            <div class="time-val" id="sw">--:--</div>
            <div class="time-label">File Stopwatch</div>
        </div>
        <div class="controls">
            <button class="btn" id="btn-toggle" title="Play/Pause" disabled><svg viewBox="0 0 24 24"><path id="toggle-path" d="M8 5v14l11-7z"/></svg> <span id="toggle-txt">Play</span></button>
            <button class="btn" id="btn-reset" title="Reset" disabled><svg viewBox="0 0 24 24"><path d="M17.65 6.35C16.2 4.9 14.21 4 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08c-.82 2.33-3.04 4-5.65 4-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/></svg></button>
        </div>
    </div>

    <div class="section pomo-sec">
        <div class="time-display" id="pomo-display" style="display:none; margin-bottom:4px;">
            <div class="time-val pomo" id="pomo-val">25:00</div>
            <div class="time-label">Pomodoro Timer</div>
        </div>
        <div class="controls">
            <div class="pomo-input-wrap" id="pomo-wrap">
                <input class="pomo-input" id="pomo-min" type="number" value="25" min="1" max="120" title="Minutes"/>
                <span>min</span>
            </div>
            <button class="btn" id="btn-pomo" title="Pomodoro Mode"><svg viewBox="0 0 24 24"><path id="pomo-path" d="M15 1H9v2h6V1zm-4 13h2V8h-2v6zm8.03-6.61l1.42-1.42c-.43-.51-.9-.99-1.41-1.41l-1.42 1.42A8.962 8.962 0 0 0 12 4c-4.97 0-9 4.03-9 9s4.03 9 9 9 9-4.03 9-9c0-2.12-.74-4.07-1.97-5.61zM12 20c-3.87 0-7-3.13-7-7s3.13-7 7-7 7 3.13 7 7-3.13 7-7 7z"/></svg> <span id="pomo-txt">Focus</span></button>
        </div>
    </div>

    <div class="footer"><div class="dot off" id="dot"></div><span id="status-text">Initializing...</span></div>
</div>
<script>
const vscode = acquireVsCodeApi();
const $ = id => document.getElementById(id);
const sw = $('sw'), fname = $('fname'), ficon = $('ficon'), dot = $('dot'), statusText = $('status-text');
const btnToggle = $('btn-toggle'), btnReset = $('btn-reset'), btnPomo = $('btn-pomo'), pomoMin = $('pomo-min');
const togglePath = $('toggle-path'), toggleTxt = $('toggle-txt'), accent = $('accent');
const pomoDisplay = $('pomo-display'), pomoVal = $('pomo-val'), pomoWrap = $('pomo-wrap'), pomoTxt = $('pomo-txt');
const pomoPath = $('pomo-path');

const PLAY='M8 5v14l11-7z', PAUSE='M6 19h4V5H6v14zm8-14v14h4V5h-4z';
const POMO_ICON='M15 1H9v2h6V1zm-4 13h2V8h-2v6zm8.03-6.61l1.42-1.42c-.43-.51-.9-.99-1.41-1.41l-1.42 1.42A8.962 8.962 0 0 0 12 4c-4.97 0-9 4.03-9 9s4.03 9 9 9 9-4.03 9-9c0-2.12-.74-4.07-1.97-5.61zM12 20c-3.87 0-7-3.13-7-7s3.13-7 7-7 7 3.13 7 7-3.13 7-7 7z';
const STOP_ICON='M6 6h12v12H6z';

let isRunning = false;
btnToggle.addEventListener('click', () => vscode.postMessage({ command: isRunning ? 'pauseStopwatch' : 'startStopwatch' }));
btnReset.addEventListener('click', () => vscode.postMessage({ command: 'resetStopwatch' }));
btnPomo.addEventListener('click', () => {
    if (btnPomo.classList.contains('pomo-active')) { vscode.postMessage({ command: 'stopPomodoro' }); }
    else { vscode.postMessage({ command: 'startPomodoro', minutes: parseInt(pomoMin.value) || 25 }); }
});

window.addEventListener('message', e => {
    const m = e.data; if (m.command !== 'update') return;
    const noFile = m.file === 'No file';
    fname.textContent = m.file;
    ficon.classList.toggle('active', !noFile);
    sw.textContent = m.stopwatch;
    isRunning = m.running;
    
    // Stopwatch State
    if (m.pomodoro) {
        btnToggle.disabled = true;
        btnReset.disabled = true;
        sw.className = 'time-val';
        togglePath.setAttribute('d', PLAY);
        toggleTxt.textContent = 'Play';
    } else {
        btnToggle.disabled = noFile || m.idle;
        btnReset.disabled = noFile || m.idle;
        sw.className = 'time-val' + (m.running ? ' running' : '');
        togglePath.setAttribute('d', m.running ? PAUSE : PLAY);
        toggleTxt.textContent = m.running ? 'Pause' : 'Play';
    }

    // Pomodoro State
    if (m.pomodoro) {
        accent.className = 'accent pomo';
        pomoWrap.style.display = 'none';
        pomoDisplay.style.display = 'flex';
        pomoVal.textContent = m.pomodoroTime;
        btnPomo.classList.add('pomo-active');
        pomoTxt.textContent = 'Stop';
        pomoPath.setAttribute('d', STOP_ICON);
    } else {
        accent.className = 'accent' + (m.idle ? ' idle' : '');
        pomoWrap.style.display = 'flex';
        pomoDisplay.style.display = 'none';
        btnPomo.classList.remove('pomo-active');
        pomoTxt.textContent = 'Focus';
        pomoPath.setAttribute('d', POMO_ICON);
    }

    // Footer Status
    if (m.idle) { dot.className = 'dot idle'; statusText.textContent = 'Idle — paused'; }
    else if (noFile) { dot.className = 'dot off'; statusText.textContent = 'No active file'; }
    else { dot.className = 'dot active'; statusText.textContent = 'Tracking active'; }
});
</script>
</body>
</html>`;

// ─── Static HTML: Dashboard ──────────────────

const DASHBOARD_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>Dashboard</title>
<style>
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: var(--vscode-font-family), system-ui, sans-serif; background: transparent; color: var(--vscode-editor-foreground); font-size: .875rem; padding: 12px; display: flex; flex-direction: column; gap: 12px; }

/* ── Hero Header ── */
.hero { background: var(--vscode-editorWidget-background); border: 1px solid var(--vscode-widget-border); border-radius: 10px; padding: 18px 16px; text-align: center; }
.project-name { font-size: .65rem; text-transform: uppercase; letter-spacing: 1.5px; color: var(--vscode-disabledForeground); font-weight: 600; margin-bottom: 4px; }
.total-time { font-size: 2.4rem; font-weight: 800; font-variant-numeric: tabular-nums; color: var(--vscode-textLink-activeForeground); line-height: 1; letter-spacing: -1.5px; }
.total-label { font-size: .65rem; color: var(--vscode-disabledForeground); margin-top: 6px; display: flex; align-items: center; justify-content: center; gap: 6px; }
.live-dot { width: 6px; height: 6px; background: #4ec94e; border-radius: 50%; box-shadow: 0 0 5px #4ec94e88; animation: blink 1.5s infinite; flex-shrink: 0; }
.live-dot.idle { background: var(--vscode-editorWarning-foreground); box-shadow: 0 0 5px rgba(255,165,0,.4); }
@keyframes blink { 0%,100%{opacity:1} 50%{opacity:.3} }

/* ── Toolbar ── */
.toolbar { display: flex; gap: 4px; align-items: center; flex-wrap: wrap; }
.tab { background: var(--vscode-editorWidget-background); border: 1px solid var(--vscode-widget-border); color: var(--vscode-disabledForeground); cursor: pointer; padding: 4px 10px; border-radius: 6px; font-size: .72rem; font-family: inherit; transition: all .15s; font-weight: 500; }
.tab:hover { background: var(--vscode-toolbar-hoverBackground); color: var(--vscode-foreground); }
.tab.active { background: var(--vscode-textLink-activeForeground); color: var(--vscode-editor-background); font-weight: 700; border-color: transparent; }
.spacer { flex: 1; }
.export-btn { background: var(--vscode-editorWidget-background); border: 1px solid var(--vscode-widget-border); color: var(--vscode-disabledForeground); cursor: pointer; padding: 4px 10px; border-radius: 6px; font-size: .7rem; font-family: inherit; display: flex; align-items: center; gap: 5px; transition: all .15s; }
.export-btn:hover { background: var(--vscode-toolbar-hoverBackground); color: var(--vscode-foreground); }
.export-btn svg { width: 12px; height: 12px; fill: currentColor; }

/* ── Section Cards ── */
.section-card { background: var(--vscode-editorWidget-background); border: 1px solid var(--vscode-widget-border); border-radius: 10px; overflow: hidden; }
.section-header { padding: 10px 14px; border-bottom: 1px solid color-mix(in srgb, var(--vscode-widget-border) 50%, transparent); display: flex; align-items: center; gap: 6px; }
.section-icon { width: 14px; height: 14px; fill: var(--vscode-disabledForeground); flex-shrink: 0; }
.section-icon.branch { fill: var(--vscode-terminal-ansiCyan); }
.section-icon.file { fill: var(--vscode-textLink-activeForeground); }
.section-title { font-size: .7rem; text-transform: uppercase; letter-spacing: .8px; color: var(--vscode-disabledForeground); font-weight: 700; }
.section-count { font-size: .6rem; color: var(--vscode-disabledForeground); margin-left: auto; font-weight: 500; }

.section-body { padding: 0; }
.section-body ul { list-style: none; }
.section-body li { padding: 8px 14px; border-bottom: 1px solid color-mix(in srgb, var(--vscode-widget-border) 25%, transparent); transition: background .1s; }
.section-body li:last-child { border-bottom: none; }
.section-body li:hover { background: color-mix(in srgb, var(--vscode-toolbar-hoverBackground) 50%, transparent); }

.row { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
.f-name { font-size: .8rem; font-weight: 500; word-break: break-all; line-height: 1.3; }
.f-time { font-size: .78rem; white-space: nowrap; font-variant-numeric: tabular-nums; color: var(--vscode-descriptionForeground); flex-shrink: 0; font-weight: 600; }
.bar { height: 3px; border-radius: 3px; background: color-mix(in srgb, var(--vscode-widget-border) 40%, transparent); margin-top: 5px; overflow: hidden; }
.bar-fill { height: 100%; border-radius: 3px; transition: width .4s ease; }
.bar-fill.file { background: var(--vscode-textLink-activeForeground); }
.bar-fill.branch { background: var(--vscode-terminal-ansiCyan); }
.badge { display: inline-block; font-size: .5rem; border-radius: 3px; padding: 1px 5px; font-weight: 700; text-transform: uppercase; letter-spacing: .5px; vertical-align: middle; margin-left: 6px; }
.badge.file-badge { background: color-mix(in srgb, var(--vscode-textLink-activeForeground) 15%, transparent); color: var(--vscode-textLink-activeForeground); }
.badge.branch-badge { background: color-mix(in srgb, var(--vscode-terminal-ansiCyan) 15%, transparent); color: var(--vscode-terminal-ansiCyan); }

.empty { color: var(--vscode-disabledForeground); font-size: .8rem; line-height: 1.6; padding: 24px 16px; text-align: center; display: none; background: var(--vscode-editorWidget-background); border: 1px solid var(--vscode-widget-border); border-radius: 10px; }
</style>
</head>
<body>

<div class="hero">
    <div class="project-name" id="project">--</div>
    <div class="total-time" id="total">0s</div>
    <div class="total-label"><span class="live-dot" id="live-dot"></span> Total focus time</div>
</div>

<div class="toolbar">
    <button class="tab active" data-tab="today">Today</button>
    <button class="tab" data-tab="week">Week</button>
    <button class="tab" data-tab="month">Month</button>
    <button class="tab" data-tab="all">All Time</button>
    <div class="spacer"></div>
    <button class="export-btn" id="btn-export" title="Export CSV"><svg viewBox="0 0 24 24"><path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/></svg>Export</button>
</div>

<div class="section-card" id="branch-card" style="display:none">
    <div class="section-header">
        <svg class="section-icon branch" viewBox="0 0 24 24"><path d="M6 3v6.33c0 .79.4 1.53 1.07 1.97l4.93 3.27V18a3 3 0 1 0 2 0v-3.43l4.93-3.27A2.32 2.32 0 0 0 20 9.33V3H6zm12 6.33L12 13.6 6 9.33V5h12v4.33z"/></svg>
        <span class="section-title">Branches</span>
        <span class="section-count" id="branch-count"></span>
    </div>
    <div class="section-body"><ul id="branch-list"></ul></div>
</div>

<div class="section-card" id="file-card" style="display:none">
    <div class="section-header">
        <svg class="section-icon file" viewBox="0 0 24 24"><path d="M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6zm-1 1.5L18.5 9H13V3.5zM6 20V4h5v6h6v10H6z"/></svg>
        <span class="section-title">Files</span>
        <span class="section-count" id="file-count"></span>
    </div>
    <div class="section-body"><ul id="list"></ul></div>
</div>

<div class="empty" id="empty">No data recorded for this period yet.</div>

<script>
const vscode = acquireVsCodeApi();
const $ = id => document.getElementById(id);
const tabs = document.querySelectorAll('.tab');
function esc(s) { return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
tabs.forEach(b => b.addEventListener('click', () => {
    tabs.forEach(t => t.classList.remove('active'));
    b.classList.add('active');
    vscode.postMessage({ command: 'switchTab', tab: b.dataset.tab });
}));
$('btn-export').addEventListener('click', () => vscode.postMessage({ command: 'exportCsv' }));
window.addEventListener('message', e => {
    const m = e.data; if (m.command !== 'data') return;
    $('project').textContent = m.project;
    $('total').textContent = m.totalFormatted;
    $('live-dot').className = 'live-dot' + (m.idle ? ' idle' : '');
    tabs.forEach(t => t.classList.toggle('active', t.dataset.tab === m.tab));

    const hasBranches = m.branches && m.branches.length > 0;
    const hasFiles = m.files && m.files.length > 0;

    if (!hasBranches && !hasFiles) {
        $('branch-card').style.display = 'none'; $('file-card').style.display = 'none';
        $('branch-list').innerHTML = ''; $('list').innerHTML = '';
        $('empty').style.display = ''; return;
    }
    $('empty').style.display = 'none';

    if (hasBranches) {
        $('branch-card').style.display = '';
        $('branch-count').textContent = m.branches.length + ' branch' + (m.branches.length !== 1 ? 'es' : '');
        const bMax = m.branches[0].seconds;
        $('branch-list').innerHTML = m.branches.map((b, i) => {
            const pct = Math.round((b.seconds / bMax) * 100);
            const badge = b.name === m.activeBranch ? '<span class="badge branch-badge">Active</span>' : (i === 0 ? '<span class="badge branch-badge">Top</span>' : '');
            return '<li><div class="row"><span class="f-name">' + esc(b.name) + badge + '</span><span class="f-time">' + b.formatted + '</span></div><div class="bar"><div class="bar-fill branch" style="width:' + pct + '%"></div></div></li>';
        }).join('');
    } else { $('branch-card').style.display = 'none'; $('branch-list').innerHTML = ''; }

    if (hasFiles) {
        $('file-card').style.display = '';
        $('file-count').textContent = m.files.length + ' file' + (m.files.length !== 1 ? 's' : '');
        const fMax = m.files[0].seconds;
        $('list').innerHTML = m.files.map((f, i) => {
            const pct = Math.round((f.seconds / fMax) * 100);
            const badge = i === 0 ? '<span class="badge file-badge">Top</span>' : '';
            return '<li><div class="row"><span class="f-name">' + esc(f.name) + badge + '</span><span class="f-time">' + f.formatted + '</span></div><div class="bar"><div class="bar-fill file" style="width:' + pct + '%"></div></div></li>';
        }).join('');
    } else { $('file-card').style.display = 'none'; $('list').innerHTML = ''; }
});
vscode.postMessage({ command: 'ready' });
</script>
</body>
</html>`;
