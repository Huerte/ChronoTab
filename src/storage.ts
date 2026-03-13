import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';

export interface FileRecord {
    seconds: number;
    lastActive: string;
}

export interface SessionData {
    project: string;
    date: string;
    totalSeconds: number;
    branches: Record<string, Record<string, FileRecord>>;
    files?: Record<string, FileRecord>;
}

function getStorageDir(workspaceRoot: string): string {
    return path.join(workspaceRoot, '.chronotab');
}

function getSessionPath(workspaceRoot: string, date: string): string {
    return path.join(getStorageDir(workspaceRoot), `${date}.json`);
}

export function ensureStorageDir(workspaceRoot: string): void {
    const dir = getStorageDir(workspaceRoot);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
}

function migrateSession(raw: SessionData): SessionData {
    if (raw.files && !raw.branches) {
        raw.branches = { '_default': raw.files };
        delete raw.files;
    }
    if (!raw.branches) {
        raw.branches = {};
    }
    return raw;
}

export function loadSession(workspaceRoot: string, date: string): SessionData {
    const filePath = getSessionPath(workspaceRoot, date);
    if (fs.existsSync(filePath)) {
        try {
            const raw = JSON.parse(fs.readFileSync(filePath, 'utf8')) as SessionData;
            return migrateSession(raw);
        } catch {
            // corrupt file fallback
        }
    }
    return { project: path.basename(workspaceRoot), date, totalSeconds: 0, branches: {} };
}

export function saveSession(workspaceRoot: string, session: SessionData): void {
    ensureStorageDir(workspaceRoot);
    const filePath = getSessionPath(workspaceRoot, session.date);
    fs.writeFileSync(filePath, JSON.stringify(session, null, 2), 'utf8');
}

export function loadAllSessions(workspaceRoot: string): SessionData[] {
    const dir = getStorageDir(workspaceRoot);
    if (!fs.existsSync(dir)) { return []; }
    return fs.readdirSync(dir)
        .filter(f => f.endsWith('.json'))
        .map(f => {
            try {
                return migrateSession(JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')) as SessionData);
            } catch { return null; }
        })
        .filter((s): s is SessionData => s !== null)
        .sort((a, b) => a.date.localeCompare(b.date));
}

export function getWeeklySessions(workspaceRoot: string): SessionData[] {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 6);
    const cutoffStr = cutoff.toISOString().slice(0, 10);
    return loadAllSessions(workspaceRoot).filter(s => s.date >= cutoffStr);
}

export function getMonthlySessions(workspaceRoot: string): SessionData[] {
    const now = new Date();
    const prefix = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    return loadAllSessions(workspaceRoot).filter(s => s.date.startsWith(prefix));
}

export function getTodayDateString(): string {
    return new Date().toISOString().slice(0, 10);
}

export interface AggregatedData {
    totalSeconds: number;
    files: Record<string, number>;
    branchTotals: Record<string, number>;
}

export function aggregateSessions(sessions: SessionData[]): AggregatedData {
    const files: Record<string, number> = {};
    const branchTotals: Record<string, number> = {};
    let totalSeconds = 0;
    for (const session of sessions) {
        totalSeconds += session.totalSeconds;
        for (const [branch, branchFiles] of Object.entries(session.branches)) {
            for (const [filename, record] of Object.entries(branchFiles)) {
                files[filename] = (files[filename] || 0) + record.seconds;
                branchTotals[branch] = (branchTotals[branch] || 0) + record.seconds;
            }
        }
    }
    return { totalSeconds, files, branchTotals };
}

export function getCurrentBranch(workspaceRoot: string): string {
    try {
        return execSync('git rev-parse --abbrev-ref HEAD', {
            cwd: workspaceRoot, encoding: 'utf8', timeout: 3000
        }).trim() || '_default';
    } catch {
        return '_default';
    }
}

export function generateCsv(sessions: SessionData[]): string {
    const lines: string[] = ['Date,Branch,File,Seconds,Time'];
    for (const session of sessions) {
        for (const [branch, branchFiles] of Object.entries(session.branches)) {
            for (const [filename, record] of Object.entries(branchFiles)) {
                const h = Math.floor(record.seconds / 3600);
                const m = Math.floor((record.seconds % 3600) / 60);
                const s = record.seconds % 60;
                const fmt = h > 0 ? `${h}h ${String(m).padStart(2, '0')}m` : m > 0 ? `${m}m ${String(s).padStart(2, '0')}s` : `${s}s`;
                lines.push(`${session.date},${branch},${filename},${record.seconds},${fmt}`);
            }
        }
    }
    return lines.join('\n');
}
