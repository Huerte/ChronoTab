# ChronoTab

A Visual Studio Code extension that tracks the duration a user actively focuses on a specific file tab. It monitors editor state changes and provides a dedicated Webview UI panel to display the active timer, along with basic controls to pause, resume, and reset the current session.

## Installation Guide

Follow these simple steps to install the extension from the source code onto any machine.

### Prerequisites
Before you begin, ensure you have the following installed on your machine:
1. **Visual Studio Code**
2. **Node.js** (which includes `npm`)

---

### Step 1: Get the Code
Clone this repository to your local machine using your terminal or command prompt:

```bash
git clone <your-repository-url>
cd ChronoTab
```

### Step 2: Open in VS Code
Open the downloaded folder inside Visual Studio Code:

```bash
code .
```

### Step 3: Install Dependencies
Open the integrated terminal in VS Code (`Ctrl + ` \` or `View > Terminal`) and install the required Node modules:

```bash
npm install
```

### Step 4: Install the Packaging Tool
To build the extension file, you need the official VS Code Extension Manager (`vsce`). Install it globally:

```bash
npm install -g @vscode/vsce
```

### Step 5: Package the Extension
Compile the source code and package it into an installable `.vsix` file:

```bash
npm run compile
vsce package --no-dependencies
```
*(If it asks about a missing repository field, just type `y` and press Enter).*

You will now see a file named `chronotab-1.0.0.vsix` in your folder.

### Step 6: Install the Extension
Install the generated file directly into your VS Code editor using this command:

```bash
code --install-extension chronotab-1.0.0.vsix
```

### Step 7: Reload and Use
1. Reload your VS Code window (`Ctrl + Shift + P`, type `Reload Window`, and press Enter).
2. Open your File Explorer sidebar on the left.
3. Look for the new **ChronoTab** panel.
4. You can click and drag this panel into your bottom terminal area, secondary sidebar, or anywhere you prefer!

---

### Features
* **Offline Functionality**: Bundles inline SVG assets rather than relying on external CDNs or web fonts.
* **Responsive Panel Layout**: Built with a CSS Grid architecture that adjusts between horizontal and vertical viewing panes automatically.
* **Asynchronous Updates**: Separates the interval tick logic from the UI rendering cycle via `webview.postMessage` integration.
* **Component Controls**: Supports manual runtime pause, resume, and hard-reset functions mapped directly to the active editor state.
