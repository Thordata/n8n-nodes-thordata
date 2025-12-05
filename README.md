# n8n-nodes-thordata

Official n8n node for [Thordata](https://thordata.com/).
This node allows you to integrate Thordata's Residential Proxies and Scraping APIs directly into your n8n workflows.

## Features

*   **SERP Search**: Real-time search results from Google, Bing, Yandex, and DuckDuckGo.
*   **Universal Scrape**: Scrape any URL with headless browser rendering capabilities.
    *   Automatic Protocol Handling (Auto-adds `https://`)
    *   Supports HTML output
    *   Supports Screenshot (PNG) output
*   **Residential Proxies**: All requests are routed through Thordata's high-quality residential proxy network.

## Installation

You can install this node directly from the n8n Community Nodes panel.

1.  Go to **Settings** > **Community Nodes**.
2.  Select **Install**.
3.  Enter the package name: `n8n-nodes-thordata`.

## Credentials

You need a **Thordata Scraper Token** to use this node.

1.  Log in to your [Thordata Dashboard](https://thordata.com/dashboard).
2.  Copy your Scraper Token.
3.  In n8n, create a new credential for **Thordata API** and paste the token.

## Usage

### Universal Scrape
*   **URL**: Enter the target website (e.g., `www.example.com`).
*   **Output Format**: Choose `HTML` for text data or `PNG` for a screenshot.
*   **Render JavaScript**: Toggle `True` to handle dynamic websites (SPA).

