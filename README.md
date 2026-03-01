<div align="center">

# ChronoTab

[![Version](https://img.shields.io/badge/version-1.0.0-blue.svg)](#)
[![VS Code](https://img.shields.io/badge/VS%20Code-%5E1.80.0-blueviolet.svg)](https://code.visualstudio.com/)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](#)

**A dynamic Visual Studio Code extension that accurately tracks how long you actively focus on a specific file tab.**

</div>

---

## Features

ChronoTab provides a dedicated Webview UI panel to display your active timer, along with intuitive controls to pause, resume, and reset your current session. Designed to be offline-capable and highly responsive.

- **Responsive Panel Layout:** Built with a CSS Grid architecture that automatically adapts between horizontal and vertical viewing panes.
- **Asynchronous Updates:** Separates the interval tick logic from the UI rendering cycle via robust `webview.postMessage` integration.
- **Component Controls:** Supports manual runtime pause, resume, and hard-reset functions mapped directly to the active editor state.

---

## Installation Guide

Follow these steps to install the extension from the source code onto your local machine.

### Prerequisites

Before you begin, ensure you have the following installed on your machine:
- **Visual Studio Code** (v1.80.0 or higher)
- **Node.js** (which includes `npm`)

### Step 1: Get the Code
Clone this repository to your local machine using your terminal or command prompt:

```bash
git clone https://github.com/Huerte/ChronoTab.git
cd ChronoTab
```

### Step 2: Open in VS Code
Open the downloaded folder inside Visual Studio Code:

```bash
code .
```

### Step 3: Install Dependencies
Open the integrated terminal in VS Code (`Ctrl` + `\`` or **View > Terminal**) and install the required Node modules:

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

You will now see a file named `chronotab-1.0.0.vsix` in your project folder.

### Step 6: Install the Extension
Install the generated file directly into your VS Code editor using this command:

```bash
code --install-extension chronotab-1.0.0.vsix
```

---

## Usage

1. Reload your VS Code window (`Ctrl` + `Shift` + `P`, type **Reload Window**, and press Enter).
2. Open your File Explorer sidebar on the left.
3. Look for the new **ChronoTab** panel.
4. You can click and drag this panel into your bottom terminal area, secondary sidebar, or anywhere you prefer!
5. Start tracking your time seamlessly as you work across different file tabs. 

---

## Contributing

Contributions, issues, and feature requests are welcome!

1. Fork the Project
2. Create your Feature Branch (`git checkout -b feature/AmazingFeature`)
3. Commit your Changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the Branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

---

## License

Distributed under the MIT License. See `LICENSE` for more information.

---

&copy; 2026 [Huerte](https://github.com/Huerte). All Rights Reserved.
