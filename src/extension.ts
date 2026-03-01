import * as vscode from 'vscode';

let timerInterval: NodeJS.Timeout | undefined;
let elapsedSeconds = 0;
let isPaused = false;
let currentFile = "No file";
let uiProvider: TimerViewProvider;

export function activate(context: vscode.ExtensionContext) {
    uiProvider = new TimerViewProvider();
    
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(TimerViewProvider.viewType, uiProvider)
    );

    context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(() => {
        const editor = vscode.window.activeTextEditor;
        
        if (!editor || editor.document.uri.scheme !== 'file') {
            currentFile = "No file";
            uiProvider.updateState(currentFile, "00:00", false);
            resetTimer(true); // Hard reset
        } else {
            currentFile = editor.document.fileName.split(/[\\/]/).pop() || 'Unknown';
            resetTimer(true);
            startTimer();
        }
    }));

    if (vscode.window.activeTextEditor && vscode.window.activeTextEditor.document.uri.scheme === 'file') {
        currentFile = vscode.window.activeTextEditor.document.fileName.split(/[\\/]/).pop() || 'Unknown';
        startTimer();
    } else {
        setTimeout(() => uiProvider.updateState("No file", "00:00", false), 1000); 
    }
}

function startTimer() {
    isPaused = false;
    uiProvider.updateState(currentFile, formatTime(elapsedSeconds), true);

    if (timerInterval) {
        clearInterval(timerInterval);
    }
    
    timerInterval = setInterval(() => {
        if (!isPaused) {
            elapsedSeconds++;
            uiProvider.updateState(currentFile, formatTime(elapsedSeconds), true);
        }
    }, 1000);
}

function resetTimer(clearSeconds: boolean) {
    if (timerInterval) {
        clearInterval(timerInterval);
        timerInterval = undefined;
    }
    if (clearSeconds) {
        elapsedSeconds = 0;
    }
    isPaused = false;
    uiProvider.updateState(currentFile, formatTime(elapsedSeconds), false);
}

function formatTime(seconds: number): string {
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;

    const pad = (n: number) => n.toString().padStart(2, '0');

    if (hrs > 0) {
        return `${pad(hrs)}:${pad(mins)}:${pad(secs)}`;
    }
    return `${pad(mins)}:${pad(secs)}`;
}

class TimerViewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'chronotab.timerView';
    private _view?: vscode.WebviewView;

    constructor() {}

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        _context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken,
    ) {
        this._view = webviewView;
        webviewView.webview.options = { enableScripts: true };
        webviewView.webview.html = this._getHtmlForWebview();

        webviewView.webview.onDidReceiveMessage(message => {
            switch (message.command) {
                case 'togglePause':
                    if (currentFile === "No file") return;
                    isPaused = !isPaused;
                    this.updateState(currentFile, formatTime(elapsedSeconds), !isPaused);
                    break;
                case 'resetTimer':
                    if (currentFile === "No file") return;
                    elapsedSeconds = 0;
                    isPaused = true;
                    this.updateState(currentFile, formatTime(elapsedSeconds), false);
                    break;
            }
        });
        
        // Push initial state
        setTimeout(() => this.updateState(currentFile, formatTime(elapsedSeconds), !isPaused && currentFile !== "No file"), 500);
    }

    public updateState(filename: string, time: string, isRunning: boolean) {
        if (this._view) {
            this._view.webview.postMessage({ command: 'updateState', filename, time, isRunning });
        }
    }

    private _getHtmlForWebview() {
        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>ChronoTab</title>
    <style>
        :root {
            --glass-bg: rgba(var(--vscode-editorWidget-background), 0.7);
            --glass-border: rgba(var(--vscode-widget-border), 0.3);
            --active-color: var(--vscode-textLink-activeForeground);
            --inactive-color: var(--vscode-disabledForeground);
            --btn-hover: rgba(var(--vscode-button-background), 0.2);
            --btn-active: rgba(var(--vscode-button-background), 0.4);
        }
        
        body {
            font-family: var(--vscode-font-family), -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif;
            margin: 0;
            padding: 12px;
            display: flex;
            align-items: flex-start;
            justify-content: center;
            min-height: 100vh;
            box-sizing: border-box;
            background-color: transparent;
            color: var(--vscode-editor-foreground);
        }

        /* Responsive Layout Container */
        .container {
            background: var(--vscode-editorWidget-background);
            border: 1px solid var(--vscode-widget-border);
            border-radius: 12px;
            padding: 20px;
            width: 100%;
            max-width: 400px;
            transition: all 0.3s cubic-bezier(0.25, 0.8, 0.25, 1);
            position: relative;
            overflow: hidden;
            display: grid;
            gap: 15px;
            text-align: center;
            /* Container Query Fallback: Default to stack layout for sidebar */
            grid-template-columns: 1fr;
            grid-template-areas: 
                "header"
                "timer"
                "controls";
        }

        /* Switch to horizontal layout when in wide bottom panel */
        @media (min-width: 350px) {
            .container {
                max-width: 100%;
                grid-template-columns: 1fr auto auto;
                grid-template-areas: "header timer controls";
                align-items: center;
                text-align: left;
                padding: 12px 24px;
                gap: 24px;
            }
        }

        .header-section { grid-area: header; display: flex; align-items: center; gap: 10px; justify-content: center; }
        @media (min-width: 350px) { .header-section { justify-content: flex-start; } }

        .timer-section { grid-area: timer; }
        .controls-section { grid-area: controls; display: flex; gap: 12px; justify-content: center; }

        .svg-icon {
            width: 24px;
            height: 24px;
            fill: currentColor;
            transition: all 0.3s ease;
        }

        .file-icon {
            color: var(--inactive-color);
            filter: drop-shadow(0 0 5px rgba(255,255,255,0.1));
            transition: all 0.3s ease;
        }
        .file-icon.active {
            color: var(--active-color);
            filter: drop-shadow(0 0 8px var(--active-color));
        }

        .file-name {
            font-size: 1rem;
            color: var(--vscode-descriptionForeground);
            word-break: break-all;
            font-weight: 600;
            letter-spacing: 0.5px;
            display: -webkit-box;
            -webkit-line-clamp: 2;
            -webkit-box-orient: vertical;
            overflow: hidden;
            line-height: 1.3;
        }

        .timer-display {
            font-size: clamp(2rem, 8vw, 2.8rem);
            font-weight: 800;
            font-variant-numeric: tabular-nums;
            color: var(--inactive-color);
            letter-spacing: -1px;
            transition: color 0.3s ease, text-shadow 0.3s ease;
            white-space: nowrap;
        }
        
        .timer-display.running {
            color: var(--active-color);
            text-shadow: 0 0 15px rgba(var(--vscode-textLink-activeForeground), 0.4);
            animation: pulse 2s infinite cubic-bezier(0.4, 0, 0.6, 1);
        }

        @keyframes pulse {
            0% { opacity: 1; text-shadow: 0 0 15px rgba(var(--vscode-textLink-activeForeground), 0.4); }
            50% { opacity: 0.7; text-shadow: 0 0 5px rgba(var(--vscode-textLink-activeForeground), 0.1); }
            100% { opacity: 1; text-shadow: 0 0 15px rgba(var(--vscode-textLink-activeForeground), 0.4); }
        }

        .btn {
            background: transparent;
            border: 1px solid var(--vscode-widget-border);
            color: var(--vscode-foreground);
            cursor: pointer;
            padding: 8px 12px;
            border-radius: 6px;
            display: flex;
            align-items: center;
            justify-content: center;
            transition: all 0.2s ease;
        }
        .btn:hover:not(:disabled) {
            background: var(--btn-hover);
            border-color: var(--vscode-focusBorder);
        }
        .btn:active:not(:disabled) {
            background: var(--btn-active);
            transform: scale(0.96);
        }
        .btn:disabled {
            opacity: 0.4;
            cursor: not-allowed;
        }

        /* Inline SVG Definitions for 100% Offline */
        .icon-file { d: path("M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6zm-1 1.5L18.5 9H13V3.5zM6 20V4h5v6h6v10H6z"); }
        .icon-play { d: path("M8 5v14l11-7z"); }
        .icon-pause { d: path("M6 19h4V5H6v14zm8-14v14h4V5h-4z"); }
        .icon-stop { d: path("M6 6h12v12H6z"); }
        .icon-reset { d: path("M17.65 6.35C16.2 4.9 14.21 4 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08c-.82 2.33-3.04 4-5.65 4-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"); }
    </style>
</head>
<body>
    <div class="container" id="panel-container">
        
        <div class="header-section">
            <svg class="svg-icon file-icon" id="icon" viewBox="0 0 24 24">
                <path class="icon-file"></path>
            </svg>
            <div class="file-name" id="filename">Waiting...</div>
        </div>
        
        <div class="timer-section">
            <div class="timer-display" id="timer">00:00</div>
        </div>

        <div class="controls-section">
            <button class="btn" id="btn-toggle" title="Play / Pause" disabled>
                <svg class="svg-icon" viewBox="0 0 24 24">
                    <path id="toggle-path" class="icon-play"></path>
                </svg>
            </button>
            <button class="btn" id="btn-reset" title="Reset Timer" disabled>
                <svg class="svg-icon" viewBox="0 0 24 24">
                    <path class="icon-reset"></path>
                </svg>
            </button>
        </div>

    </div>
    
    <script>
        const vscode = acquireVsCodeApi();
        
        const ui = {
            filename: document.getElementById('filename'),
            timer: document.getElementById('timer'),
            icon: document.getElementById('icon'),
            btnToggle: document.getElementById('btn-toggle'),
            btnReset: document.getElementById('btn-reset'),
            togglePath: document.getElementById('toggle-path')
        };

        ui.btnToggle.addEventListener('click', () => vscode.postMessage({ command: 'togglePause' }));
        ui.btnReset.addEventListener('click', () => vscode.postMessage({ command: 'resetTimer' }));

        window.addEventListener('message', event => {
            const msg = event.data;
            if (msg.command === 'updateState') {
                const noFile = msg.filename === 'No file';
                
                ui.filename.textContent = msg.filename;
                ui.timer.textContent = msg.time;
                
                // Toggle Button States
                ui.btnToggle.disabled = noFile;
                ui.btnReset.disabled = noFile;

                if (noFile) {
                    ui.timer.classList.remove('running');
                    ui.icon.classList.remove('active');
                    ui.togglePath.className.baseVal = 'icon-play';
                } else {
                    if (msg.isRunning) {
                        ui.timer.classList.add('running');
                        ui.icon.classList.add('active');
                        ui.togglePath.className.baseVal = 'icon-pause'; 
                    } else {
                        ui.timer.classList.remove('running');
                        ui.icon.classList.add('active'); // Keep file icon active but stop pulse
                        ui.togglePath.className.baseVal = 'icon-play'; 
                    }
                }
            }
        });
    </script>
</body>
</html>`;
    }
}

export function deactivate() {
    resetTimer(true);
}
