import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

export interface TodoItemData {
    id: string;
    text: string;
    done: boolean;
    fileContext?: {
        file: string;
        line: number;
    };
}

export class TodoStore {
    private uri: vscode.Uri;
    private _onDidChange = new vscode.EventEmitter<void>();
    public readonly onDidChange = this._onDidChange.event;
    private items: TodoItemData[] = [];
    private watcher: vscode.FileSystemWatcher | undefined;

    constructor() {
        if (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) {
            const workspaceRoot = vscode.workspace.workspaceFolders[0].uri.fsPath;
            const todoDir = path.join(workspaceRoot, '.chronotab', 'todo');
            if (!fs.existsSync(todoDir)) {
                fs.mkdirSync(todoDir, { recursive: true });
            }
            this.uri = vscode.Uri.file(path.join(todoDir, 'list.json'));
        } else {
            const home = process.env.HOME || process.env.USERPROFILE || '';
            const globalDir = path.join(home, '.chronotab', 'todo');
            if (!fs.existsSync(globalDir)) {
                fs.mkdirSync(globalDir, { recursive: true });
            }
            this.uri = vscode.Uri.file(path.join(globalDir, 'list.json'));
        }
    }

    public async initialize(context: vscode.ExtensionContext): Promise<void> {
        this.watcher = vscode.workspace.createFileSystemWatcher(this.uri.fsPath);
        context.subscriptions.push(this.watcher);

        this.watcher.onDidChange(() => this.loadData());
        this.watcher.onDidCreate(() => this.loadData());
        this.watcher.onDidDelete(() => {
            this.items = [];
            this._onDidChange.fire();
        });

        await this.loadData();
    }

    public getTodos(): TodoItemData[] {
        return this.items;
    }

    public async addTodo(text: string, fileContext?: { file: string, line: number }): Promise<void> {
        const newItem: TodoItemData = {
            id: Date.now().toString(),
            text,
            done: false,
            fileContext
        };
        this.items.push(newItem);
        await this.saveData();
    }

    public async markDone(id: string): Promise<void> {
        const item = this.items.find(i => i.id === id);
        if (item) {
            item.done = true;
            await this.saveData();
        }
    }
    
    public async deleteTodo(id: string): Promise<void> {
        this.items = this.items.filter(i => i.id !== id);
        await this.saveData();
    }

    public async markAllDone(): Promise<void> {
        this.items.forEach(i => i.done = true);
        await this.saveData();
    }

    public async deleteAll(): Promise<void> {
        this.items = [];
        await this.saveData();
    }

    public async markItemsDone(ids: string[]): Promise<void> {
        this.items.forEach(i => {
            if (ids.includes(i.id)) i.done = true;
        });
        await this.saveData();
    }

    public async deleteItems(ids: string[]): Promise<void> {
        this.items = this.items.filter(i => !ids.includes(i.id));
        await this.saveData();
    }

    public async reorder(sourceId: string, targetId: string): Promise<void> {
        const sourceIndex = this.items.findIndex(i => i.id === sourceId);
        const targetIndex = this.items.findIndex(i => i.id === targetId);
        if (sourceIndex > -1 && targetIndex > -1) {
            const [item] = this.items.splice(sourceIndex, 1);
            this.items.splice(targetIndex, 0, item);
            await this.saveData();
        }
    }

    private async loadData(): Promise<void> {
        try {
            const data = await vscode.workspace.fs.readFile(this.uri);
            this.items = JSON.parse(Buffer.from(data).toString('utf8'));
            this._onDidChange.fire();
        } catch (e) {
            this.items = [];
            this._onDidChange.fire();
        }
    }

    private async saveData(): Promise<void> {
        try {
            const data = Buffer.from(JSON.stringify(this.items, null, 2), 'utf8');
            await vscode.workspace.fs.writeFile(this.uri, data);
            this._onDidChange.fire();
        } catch (e) {
            vscode.window.showErrorMessage('Failed to save todo items.');
        }
    }
}
