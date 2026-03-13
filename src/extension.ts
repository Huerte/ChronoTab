import * as vscode from 'vscode';
import * as path from 'path';
import * as storage from './storage';

let workspaceRoot: string | undefined;
let currentDate: string = storage.getTodayDateString();
let currentSession: storage.SessionData;

let activeFile: string | undefined;
let activeFileStartTime: number | undefined;

const stopwatchPerFile = new Map<string, number>();
const stopwatchRunningFiles = new Set<string>();
let stopwatchInterval: NodeJS.Timeout | undefined;
let autoSaveInterval: NodeJS.Timeout | undefined;
let dashboardInterval: NodeJS.Timeout | undefined;

let timerProvider: TimerViewProvider;
let dashboardProvider: DashboardViewProvider;

export function activate(context: vscode.ExtensionContext) {
    const wsFolders = vscode.workspace.workspaceFolders;
    if (wsFolders && wsFolders.length > 0) {
        workspaceRoot = wsFolders[0].uri.fsPath;
        storage.ensureStorageDir(workspaceRoot);
        currentSession = storage.loadSession(workspaceRoot, currentDate);
    }

    timerProvider = new TimerViewProvider();
    dashboardProvider = new DashboardViewProvider();

    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(TimerViewProvider.viewType, timerProvider),
        vscode.window.registerWebviewViewProvider(DashboardViewProvider.viewType, dashboardProvider)
    );

    context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(onEditorChange));

    autoSaveInterval = setInterval(flushSession, 30_000);
    dashboardInterval = setInterval(() => { syncTracking(); dashboardProvider.pushData(); }, 5_000);

    const editor = vscode.window.activeTextEditor;
    if (editor && editor.document.uri.scheme === 'file' && !editor.document.fileName.includes('.chronotab')) {
        beginTracking(editor.document.fileName);
    } else {
        setTimeout(() => timerProvider.push({ file: 'No file', stopwatch: '00:00', running: false }), 800);
    }
}

function onEditorChange() {
    pauseTracking();

    if (stopwatchInterval) {
        clearInterval(stopwatchInterval);
        stopwatchInterval = undefined;
    }

    const editor = vscode.window.activeTextEditor;
    if (editor && editor.document.uri.scheme === 'file') {
        if (editor.document.fileName.includes('.chronotab')) {
            activeFile = undefined;
            timerProvider.push({ file: 'No file', stopwatch: '00:00', running: false });
            return;
        }
        beginTracking(editor.document.fileName);
    } else {
        activeFile = undefined;
        timerProvider.push({ file: 'No file', stopwatch: '00:00', running: false });
    }
}

function beginTracking(fullPath: string) {
    const filename = path.basename(fullPath);
    activeFile = filename;
    activeFileStartTime = Date.now();

    const secs = stopwatchPerFile.get(filename) || 0;
    const wasStarted = stopwatchRunningFiles.has(filename);

    if (wasStarted) {
        const target = filename;
        stopwatchInterval = setInterval(() => {
            const s = (stopwatchPerFile.get(target) || 0) + 1;
            stopwatchPerFile.set(target, s);
            timerProvider.push({ file: target, stopwatch: formatTime(s), running: true });
        }, 1000);
    }

    timerProvider.push({ file: filename, stopwatch: formatTime(secs), running: wasStarted });
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
    if (!currentSession.files[filename]) {
        currentSession.files[filename] = { seconds: 0, lastActive: now };
    }
    currentSession.files[filename].seconds += seconds;
    currentSession.files[filename].lastActive = now;
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

function startStopwatch() {
    if (!activeFile || stopwatchRunningFiles.has(activeFile)) { return; }
    const filename = activeFile;
    stopwatchRunningFiles.add(filename);
    if (stopwatchInterval) { clearInterval(stopwatchInterval); }
    stopwatchInterval = setInterval(() => {
        const s = (stopwatchPerFile.get(filename) || 0) + 1;
        stopwatchPerFile.set(filename, s);
        timerProvider.push({ file: filename, stopwatch: formatTime(s), running: true });
    }, 1000);
    timerProvider.push({ file: filename, stopwatch: formatTime(stopwatchPerFile.get(filename) || 0), running: true });
}

function pauseStopwatch() {
    if (stopwatchInterval) { clearInterval(stopwatchInterval); stopwatchInterval = undefined; }
    if (activeFile) {
        stopwatchRunningFiles.delete(activeFile);
        timerProvider.push({ file: activeFile, stopwatch: formatTime(stopwatchPerFile.get(activeFile) || 0), running: false });
    }
}

function resetStopwatch() {
    pauseStopwatch();
    if (activeFile) {
        stopwatchPerFile.set(activeFile, 0);
        timerProvider.push({ file: activeFile, stopwatch: '00:00', running: false });
    }
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
    flushSession();
    if (autoSaveInterval) { clearInterval(autoSaveInterval); }
    if (stopwatchInterval) { clearInterval(stopwatchInterval); }
    if (dashboardInterval) { clearInterval(dashboardInterval); }
}

// ─── Timer View ──────────────────────────────

interface UIState { file: string; stopwatch: string; running: boolean; }

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
            }
        });
        setTimeout(() => {
            const file = activeFile || 'No file';
            const secs = file !== 'No file' ? (stopwatchPerFile.get(file) || 0) : 0;
            const running = file !== 'No file' && stopwatchRunningFiles.has(file);
            this.push({ file, stopwatch: formatTime(secs), running });
        }, 600);
    }

    public push(state: UIState) {
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
        wv.webview.onDidReceiveMessage(msg => {
            if (msg.command === 'switchTab') { this._activeTab = msg.tab; this.pushData(); }
            if (msg.command === 'ready') { this.pushData(); }
        });
    }

    public pushData() {
        if (!this._view) { return; }
        const sessions = this._loadTab(this._activeTab);
        const agg = storage.aggregateSessions(sessions);
        const projectName = workspaceRoot ? path.basename(workspaceRoot) : 'Project';
        const files = Object.entries(agg.files)
            .sort((a, b) => b[1] - a[1])
            .map(([name, sec]) => ({ name, seconds: sec, formatted: fmtDuration(sec) }));
        this._view.webview.postMessage({
            command: 'data', tab: this._activeTab, project: projectName,
            totalFormatted: fmtDuration(agg.totalSeconds), files
        });
    }

    public refresh() { this.pushData(); }

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

// ─── Static HTML Templates ──────────────────

const TIMER_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>ChronoTab</title>
<style>
:root {
    --active: var(--vscode-textLink-activeForeground);
    --muted: var(--vscode-disabledForeground);
    --bg: var(--vscode-editorWidget-background);
    --border: var(--vscode-widget-border);
    --hover: var(--vscode-toolbar-hoverBackground);
}
* { box-sizing: border-box; margin: 0; padding: 0; }
body {
    font-family: var(--vscode-font-family), system-ui, sans-serif;
    background: transparent;
    color: var(--vscode-editor-foreground);
    padding: 10px;
    display: flex;
    align-items: flex-start;
    justify-content: center;
}
.card {
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 10px;
    width: 100%;
    overflow: hidden;
}
.card::before { content: ''; display: block; height: 3px; background: linear-gradient(90deg, var(--active), var(--vscode-terminal-ansiCyan)); }
.body-row {
    display: grid;
    grid-template-columns: 1fr;
    grid-template-areas: "header" "time" "controls";
    padding: 16px; gap: 12px; text-align: center;
}
@media (min-width: 340px) {
    .body-row {
        grid-template-columns: 1fr auto auto;
        grid-template-areas: "header time controls";
        text-align: left; align-items: center; gap: 16px;
    }
}
.header { grid-area: header; display: flex; align-items: center; gap: 8px; }
.file-icon { width: 20px; height: 20px; flex-shrink: 0; fill: var(--muted); transition: fill .3s; }
.file-icon.active { fill: var(--active); }
.filename { font-size: .875rem; font-weight: 600; color: var(--vscode-descriptionForeground); word-break: break-all; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.time-section { grid-area: time; }
.stopwatch { font-size: clamp(1.8rem, 7vw, 2.5rem); font-weight: 800; font-variant-numeric: tabular-nums; letter-spacing: -1px; color: var(--muted); transition: color .3s, text-shadow .3s; white-space: nowrap; }
.stopwatch.running { color: var(--active); text-shadow: 0 0 12px color-mix(in srgb, var(--active) 40%, transparent); animation: pulse 2s ease-in-out infinite; }
@keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.65} }
.label { font-size: .65rem; text-transform: uppercase; letter-spacing: 1px; color: var(--muted); margin-top: 2px; }
.controls { grid-area: controls; display: flex; gap: 8px; justify-content: center; }
.btn { background: transparent; border: 1px solid var(--border); color: var(--vscode-foreground); cursor: pointer; padding: 7px 10px; border-radius: 6px; display: flex; align-items: center; transition: background .15s, border-color .15s, transform .1s; }
.btn svg { width: 16px; height: 16px; fill: currentColor; pointer-events: none; }
.btn:hover:not(:disabled) { background: var(--hover); border-color: var(--vscode-focusBorder); }
.btn:active:not(:disabled) { transform: scale(.94); }
.btn:disabled { opacity: .35; cursor: default; }
.footer { border-top: 1px solid var(--border); padding: 8px 16px; display: flex; align-items: center; gap: 6px; font-size: .7rem; color: var(--muted); }
.dot { width: 6px; height: 6px; background: var(--muted); border-radius: 50%; flex-shrink: 0; transition: background .3s; }
.dot.active { background: #4ec94e; box-shadow: 0 0 5px #4ec94e88; }
</style>
</head>
<body>
<div class="card">
    <div class="body-row">
        <div class="header">
            <svg class="file-icon" id="ficon" viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6zm-1 1.5L18.5 9H13V3.5zM6 20V4h5v6h6v10H6z"/></svg>
            <span class="filename" id="fname">Waiting...</span>
        </div>
        <div class="time-section">
            <div class="stopwatch" id="sw">--:--</div>
            <div class="label">Stopwatch</div>
        </div>
        <div class="controls">
            <button class="btn" id="btn-toggle" title="Start / Pause" disabled><svg viewBox="0 0 24 24"><path id="toggle-path" d="M8 5v14l11-7z"/></svg></button>
            <button class="btn" id="btn-reset" title="Reset" disabled><svg viewBox="0 0 24 24"><path d="M17.65 6.35C16.2 4.9 14.21 4 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08c-.82 2.33-3.04 4-5.65 4-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/></svg></button>
        </div>
    </div>
    <div class="footer"><div class="dot" id="dot"></div><span id="status-text">Background tracking active</span></div>
</div>
<script>
const vscode = acquireVsCodeApi();
const sw = document.getElementById('sw'), fname = document.getElementById('fname');
const ficon = document.getElementById('ficon'), dot = document.getElementById('dot');
const statusText = document.getElementById('status-text');
const btnToggle = document.getElementById('btn-toggle'), btnReset = document.getElementById('btn-reset');
const togglePath = document.getElementById('toggle-path');
const PLAY = 'M8 5v14l11-7z', PAUSE = 'M6 19h4V5H6v14zm8-14v14h4V5h-4z';
btnToggle.addEventListener('click', () => {
    vscode.postMessage({ command: sw.classList.contains('running') ? 'pauseStopwatch' : 'startStopwatch' });
});
btnReset.addEventListener('click', () => vscode.postMessage({ command: 'resetStopwatch' }));
window.addEventListener('message', e => {
    const m = e.data; if (m.command !== 'update') return;
    const noFile = m.file === 'No file';
    fname.textContent = m.file; sw.textContent = m.stopwatch;
    btnToggle.disabled = noFile; btnReset.disabled = noFile;
    if (noFile) { sw.classList.remove('running'); ficon.classList.remove('active'); dot.classList.remove('active'); statusText.textContent = 'No active file'; togglePath.setAttribute('d', PLAY); }
    else { ficon.classList.add('active'); dot.classList.add('active'); statusText.textContent = 'Background tracking active'; if (m.running) { sw.classList.add('running'); togglePath.setAttribute('d', PAUSE); } else { sw.classList.remove('running'); togglePath.setAttribute('d', PLAY); } }
});
</script>
</body>
</html>`;

const DASHBOARD_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>Dashboard</title>
<style>
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: var(--vscode-font-family), system-ui, sans-serif; background: transparent; color: var(--vscode-editor-foreground); font-size: .875rem; padding: 10px; }
.header { margin-bottom: 10px; }
.project-name { font-size: .7rem; text-transform: uppercase; letter-spacing: 1px; color: var(--vscode-disabledForeground); }
.total-time { font-size: 2rem; font-weight: 800; font-variant-numeric: tabular-nums; color: var(--vscode-textLink-activeForeground); line-height: 1.1; letter-spacing: -1px; }
.total-label { font-size: .7rem; color: var(--vscode-disabledForeground); margin-top: 2px; display: flex; align-items: center; gap: 4px; }
.live-dot { width: 5px; height: 5px; background: #4ec94e; border-radius: 50%; box-shadow: 0 0 4px #4ec94e88; animation: blink 1.5s infinite; }
@keyframes blink { 0%,100%{opacity:1} 50%{opacity:.3} }
.tabs { display: flex; gap: 4px; margin: 10px 0; border-bottom: 1px solid var(--vscode-widget-border); padding-bottom: 6px; }
.tab { background: transparent; border: 1px solid transparent; color: var(--vscode-disabledForeground); cursor: pointer; padding: 3px 8px; border-radius: 4px; font-size: .75rem; font-family: inherit; transition: background .15s, color .15s; }
.tab:hover { background: var(--vscode-toolbar-hoverBackground); color: var(--vscode-foreground); }
.tab.active { background: var(--vscode-editorWidget-background); color: var(--vscode-textLink-activeForeground); font-weight: 600; border-color: var(--vscode-widget-border); }
#list { list-style: none; }
#list li { padding: 6px 0; border-bottom: 1px solid color-mix(in srgb, var(--vscode-widget-border) 40%, transparent); }
#list li:last-child { border-bottom: none; }
.row { display: flex; justify-content: space-between; align-items: center; gap: 6px; }
.f-name { font-size: .8rem; word-break: break-all; }
.f-time { font-size: .8rem; white-space: nowrap; font-variant-numeric: tabular-nums; color: var(--vscode-descriptionForeground); flex-shrink: 0; }
.bar { height: 2px; border-radius: 2px; background: var(--vscode-widget-border); margin-top: 4px; overflow: hidden; }
.bar-fill { height: 100%; background: var(--vscode-textLink-activeForeground); border-radius: 2px; transition: width .4s ease; }
.badge { display: inline-block; font-size: .55rem; background: var(--vscode-textLink-activeForeground); color: var(--vscode-editor-background); border-radius: 3px; padding: 1px 4px; font-weight: 700; text-transform: uppercase; letter-spacing: .5px; vertical-align: middle; margin-left: 4px; }
.empty { color: var(--vscode-disabledForeground); font-size: .8rem; line-height: 1.6; padding: 16px 0; text-align: center; display: none; }
</style>
</head>
<body>
<div class="header">
    <div class="project-name" id="project">--</div>
    <div class="total-time" id="total">0s</div>
    <div class="total-label"><span class="live-dot"></span>Total focus time</div>
</div>
<div class="tabs">
    <button class="tab active" data-tab="today">Today</button>
    <button class="tab" data-tab="week">Week</button>
    <button class="tab" data-tab="month">Month</button>
    <button class="tab" data-tab="all">All Time</button>
</div>
<ul id="list"></ul>
<div class="empty" id="empty">No data recorded for this period yet.</div>
<script>
const vscode = acquireVsCodeApi();
const tabs = document.querySelectorAll('.tab');
const list = document.getElementById('list');
const empty = document.getElementById('empty');
const project = document.getElementById('project');
const total = document.getElementById('total');
function esc(s) { return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
tabs.forEach(b => b.addEventListener('click', () => {
    tabs.forEach(t => t.classList.remove('active'));
    b.classList.add('active');
    vscode.postMessage({ command: 'switchTab', tab: b.dataset.tab });
}));
window.addEventListener('message', e => {
    const m = e.data; if (m.command !== 'data') return;
    project.textContent = m.project;
    total.textContent = m.totalFormatted;
    tabs.forEach(t => t.classList.toggle('active', t.dataset.tab === m.tab));
    if (!m.files || m.files.length === 0) { list.innerHTML = ''; empty.style.display = ''; return; }
    empty.style.display = 'none';
    const max = m.files[0].seconds;
    list.innerHTML = m.files.map((f, i) => {
        const pct = Math.round((f.seconds / max) * 100);
        const badge = i === 0 ? '<span class="badge">Top</span>' : '';
        return '<li><div class="row"><span class="f-name">' + esc(f.name) + badge + '</span><span class="f-time">' + f.formatted + '</span></div><div class="bar"><div class="bar-fill" style="width:' + pct + '%"></div></div></li>';
    }).join('');
});
vscode.postMessage({ command: 'ready' });
</script>
</body>
</html>`;
