import * as fs from 'fs';
import * as path from 'path';

export interface FileRecord {
    seconds: number;
    lastActive: string;
}

export interface SessionData {
    project: string;
    date: string;
    totalSeconds: number;
    files: Record<string, FileRecord>;
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

export function loadSession(workspaceRoot: string, date: string): SessionData {
    const filePath = getSessionPath(workspaceRoot, date);
    if (fs.existsSync(filePath)) {
        try {
            return JSON.parse(fs.readFileSync(filePath, 'utf8')) as SessionData;
        } catch {
            // Return a fresh session if the file is corrupt
        }
    }
    return {
        project: path.basename(workspaceRoot),
        date,
        totalSeconds: 0,
        files: {}
    };
}

export function saveSession(workspaceRoot: string, session: SessionData): void {
    ensureStorageDir(workspaceRoot);
    const filePath = getSessionPath(workspaceRoot, session.date);
    fs.writeFileSync(filePath, JSON.stringify(session, null, 2), 'utf8');
}

export function loadAllSessions(workspaceRoot: string): SessionData[] {
    const dir = getStorageDir(workspaceRoot);
    if (!fs.existsSync(dir)) {
        return [];
    }
    return fs.readdirSync(dir)
        .filter(f => f.endsWith('.json'))
        .map(f => {
            try {
                return JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')) as SessionData;
            } catch {
                return null;
            }
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

export function aggregateSessions(sessions: SessionData[]): { totalSeconds: number; files: Record<string, number> } {
    const files: Record<string, number> = {};
    let totalSeconds = 0;
    for (const session of sessions) {
        totalSeconds += session.totalSeconds;
        for (const [filename, record] of Object.entries(session.files)) {
            files[filename] = (files[filename] || 0) + record.seconds;
        }
    }
    return { totalSeconds, files };
}
