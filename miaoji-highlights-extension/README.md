# Feishu Minutes Highlights Exporter

A Chrome extension that exports highlighted transcript segments from Feishu Minutes (飞书妙记) as TSV files.

## What it does

When reviewing meeting transcripts in Feishu Minutes, you can highlight important segments. This extension extracts all highlighted segments and exports them as a `.tsv` file (tab-separated values), ready for use in spreadsheets or further processing.

## Install

1. Clone or download this repo
2. Open `chrome://extensions/` in Chrome
3. Enable **Developer mode** (top right)
4. Click **Load unpacked** and select this folder

## Usage

1. Open a Feishu Minutes transcript page
2. Click the extension icon in the toolbar
3. Click **[ 导出高亮 (.tsv) ]**
4. A `.tsv` file will be downloaded with your highlighted segments

## Permissions

- `activeTab` — Access the current tab to read highlight data
- `scripting` — Inject the extraction script into the page

## License

MIT
