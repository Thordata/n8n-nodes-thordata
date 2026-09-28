# n8n-nodes-thordata

> **Turn real-time search results and ready-made web datasets into n8n automations.**
>
> `n8n-nodes-thordata` connects [Thordata](https://www.thordata.com/?ls=n8n&lk=n8n) — the SERP API and structured-dataset platform for web data — to [n8n](https://n8n.io). Query search engines and buy, download, or deliver production-grade datasets straight from a workflow, with **no scraping code, no proxy management, and no HTML parsing**.

<p>
  <img alt="version" src="https://img.shields.io/npm/v/n8n-nodes-thordata">
  <img alt="license" src="https://img.shields.io/badge/license-MIT-green">
</p>

`n8n-nodes-thordata` **v0.1.5** is an n8n SERP API community node for Thordata. This release does not expose Web Scraper; Dataset ships alongside it, so existing `resource=serp` workflows keep working unchanged. A later version may add another resource without changing existing `resource=serp` workflows.

## Why teams build with Thordata + n8n

- **30+ search engines, one node** — Google, Bing, Yandex and DuckDuckGo, plus sub-engines like Images, News, Maps, Shopping, Jobs and Scholar.
- **Structured datasets on demand** — browse the catalog, purchase a one-time snapshot or a wallet subscription, then download or deliver the results as JSON-safe data for the next step.
- **Take data wherever you work** — return download links, pull files as n8n binary data, or deliver results directly to Amazon S3 or Snowflake.
- **Always current** — engines, fields and datasets are loaded dynamically from Thordata, so the catalog stays fresh without a node update.
- **Automation-native** — works as a regular node or as an AI Agent tool, with n8n's Continue-on-Fail for resilient runs.
- **Lightweight and private** — zero runtime dependencies; your API key is sent per request and is never logged or bundled.

## Contents

- [Requirements](#requirements)
- [Installation](#installation)
- [Credentials](#credentials)
- [Choose a resource](#choose-a-resource)
- [Use the SERP API resource](#use-the-serp-api-resource)
- [Use the Dataset resource](#use-the-dataset-resource)
- [Output and errors](#output-and-errors)
- [Schema reliability](#schema-reliability)
- [Privacy and security](#privacy-and-security)
- [Troubleshooting](#troubleshooting)
- [Get started in minutes](#get-started-in-minutes)
- [Explore more Thordata integrations](#explore-more-thordata-integrations)
- [Support and license](#support-and-license)

## Requirements

- Self-hosted n8n with community nodes enabled.
- A Thordata account with an **API key** and available credits. Find your key in the Thordata console at [www.thordata.com](https://www.thordata.com/?ls=n8n&lk=n8n).

This is an **unverified community node**, so unverified community nodes are not available on n8n Cloud; install it on self-hosted n8n only.

## Installation

### GUI (self-hosted)

As the n8n instance **Owner or Admin**, open **Settings → Community Nodes → Install**, enter `n8n-nodes-thordata`, accept the community-node risk warning, and install. The node loads immediately; no restart is required.

### Manual (self-hosted)

In the environment where n8n runs, install the package into n8n's nodes directory:

```sh
mkdir -p ~/.n8n/nodes
cd ~/.n8n/nodes
npm install n8n-nodes-thordata
```

**Restart n8n** after a manual install. For Docker, run these commands inside the n8n container (for example after `docker exec`) and persist `~/.n8n/nodes` across container replacement.

See n8n's [community-node installation and management guide](https://docs.n8n.io/integrations/community-nodes/installation-and-management/) for current requirements and for removal or upgrade steps.

## Credentials

Create a **Thordata API** credential with:

| Field | Default | Notes |
|---|---|---|
| **API Key** | — | Required password field, secret. Sent as `Authorization: Bearer <key>` on every request. |
| **SERP Endpoint** | `https://scraperapi.thordata.com/request` | Leave as-is unless you have a specific reason to change it. Treat it as a security-sensitive setting and use only a trusted internal or development endpoint. |
| **Dataset API Base URL** | `https://api.thordata.com/api/n8n` | Where datasets are listed, purchased, downloaded, and delivered. |

Select **Test** to validate the credential. The test sends one minimal SERP request (`engine=google&q=thordata`), so **a successful test consumes one credit**. The Bearer API Key is sent to the configured SERP Endpoint. Only credential administrators should change that endpoint; use a trusted internal/development endpoint when overriding it.

## Choose a resource

Add the **Thordata** node to a workflow, then select a **Resource**:

- **SERP API** — query search engines (Google, Bing, Yandex, DuckDuckGo and their sub-engines).
- **Dataset** — list, purchase, download, or deliver Thordata datasets.

The node's fields and parameters are driven by Thordata, so the engine and dataset catalogs stay current without a node upgrade.

## Use the SERP API resource

1. Set **Resource = SERP API**.
2. Pick an engine under **Operation Name or ID** — the dynamically loaded engines come straight from Thordata.
3. Fill the **Parameters**. The editor exposes schema fields where `visible=true` for the `is_serp_old=0` audience; hidden fields are not displayed and are not defaulted.
4. For engines that support **Encoded Location (UULE)**, a read-only field shows the value derived from `location`.
5. Expand **Options** to add **Extra Parameters JSON** as a JSON object when you need a field that is not exposed as a form input.

**How request values are applied** (in order): visible defaults → mapped values → Extra JSON → protected controls. Extra JSON may add or override most fields and hidden fields, but it can never override `engine` or `isjson`. The node sends `isjson=1`, and `json` defaults to `'1'` when absent. Country-restriction (`cr`) values accept country codes.

**Example** — `Resource = SERP API`, `Operation = google`, Parameters `{ "q": "n8n", "gl": "us", "hl": "en" }`. Output item:

```json
{
  "engine": "google",
  "query": "n8n",
  "taskId": "example-task-id",
  "result": { "organic": [] }
}
```

`taskId` is omitted when the engine does not return one; `result` is always JSON-safe; a missing query is returned as `null`.

## Use the Dataset resource

1. Set **Resource = Dataset**.
2. Choose an **Operation**:

| Operation | What it does |
|---|---|
| **List Datasets** | Retrieves the datasets you can purchase. |
| **Purchase Dataset** | Creates a one-time **Snapshot** or a wallet **Subscription**, and returns the dataset's `unique_id` plus its `delivery_id`. |
| **Download Dataset** | Returns **download links** for a ready snapshot (a lightweight HTML page), or fetches each file as **binary** data. |
| **Deliver Dataset** | Starts delivery of a ready snapshot to a destination you configure (Amazon S3 or Snowflake) and returns the queued delivery record. |
| **Video Data** | Returns Thordata's video-data contact details; it makes no request and is not purchased in-node. |

3. Fill the fields for the chosen operation (`Dataset`, `Purchase Type`, `Package`, `Records`, `Format`, `Download Mode`, `Delivery ID`, and the delivery fields).

### Purchase → Download (typical chain)

A newly created snapshot may still be packing. Run **Purchase Dataset** first, then chain **Download Dataset** or **Deliver Dataset**. If the snapshot is not ready yet, the node reports `Dataset is still being prepared. Please try again later.` — simply re-run the downstream node, or insert an n8n Wait/Retry between the two.

**Delivery ID** accepts the delivery ID the Thordata console lists for the dataset, or a snapshot ID. Left empty, the node reads it from the previous item (Purchase Dataset returns it as `delivery_id`), so a Purchase → Download chain needs no copying.

```
[ Purchase Dataset (One-time Snapshot) ]  ->  [ Download Dataset (links) ]  ->  [ ... ]
        returns delivery_id                        reads delivery_id from the previous item
```

- **Download Mode = Download Links (Fast)** returns `{ delivery_id, format, file_count, urls[] }` plus an HTML download page.
- **Download Mode = Binary Files** returns one binary item per file, named after the file stored for the snapshot (for example `amazon_products_100000_1.csv.gz`, MIME `application/gzip`).

### Delivery destinations

**Deliver Dataset** supports two destinations:

- **Amazon S3** — `Bucket`, `AWS Access Key`, `AWS Secret Key` (secret), `Region`, `Target Path`, `File Name`.
- **Snowflake** — `Account Identifier`, `Database`, `Schema`, `Role`, `User`, `Password` (secret), `Stage`, `Warehouse`, `File Name`.

Available formats: `csv`, `json`, `ndjson`, and their `.gz` variants (default `csv.gz`).

### Delivery runs asynchronously

**Deliver Dataset** returns as soon as the delivery is accepted, without waiting for the upload to finish — a successful node run means the delivery was *accepted*, not that the files have arrived:

```json
{
  "export_id": "KHx0cF3vnZ",
  "unique_id": "Thor26092415365028",
  "delivery_id": "qegc2p99ixtp5rbsu6xh6dbvag6ajs",
  "type": "s3",
  "format": "csv.gz",
  "status": "queued"
}
```

`unique_id` and `delivery_id` are the ids the Thordata console lists for the dataset and its delivery record, and `export_id` is this export's own id.

Thordata then uploads the files in the background: `status` moves to `delivering` and finally to `ready`, or to `failed` (or `dispatch_failed` when the task could not be submitted) with an `error_message` explaining the cause. Track the current state and past deliveries in the Thordata console. If a delivery fails, run **Deliver Dataset** again to create a new delivery for the same snapshot.

Subscription pause, resume, cancel, recovery payments, and run history are managed in the Thordata console.

**Example** — `List Datasets` output (abridged):

```json
{ "data": [ { "dataset_id": "3", "name": "Products" } ] }
```

## Output and errors

Each successful item keeps a stable shape. For datasets, the operation returns the result object (for example `{ "unique_id": "...", "delivery_id": "..." }`). Business errors fail the node with the upstream message (for example `Wallet balance is insufficient`). n8n's **Continue On Fail** is supported, so an error on one input produces an error item instead of stopping the whole workflow.

## Schema reliability

The schema is fetched from a fixed public URL, so editor loads are fresh; execution uses a 5-minute in-memory cache, then a last success or bundled snapshot fallback with 34 engines. There is no database or workflow persistence. No key is written to the schema call, snapshot, or logs.

## Privacy and security

- Your API key is only used as a `Bearer` token in request headers; it is never written to logs or bundled files.
- The node has **no runtime dependencies** and publishes only its compiled files, so its footprint is small and auditable.

## Troubleshooting

- **The Dataset list is empty or fails to load.** Confirm the **Dataset API Base URL** and that your account has dataset access.
- **`Dataset is still being prepared.`** The snapshot is still packing — re-run the Download/Deliver node after a short wait, or add an n8n Wait/Retry.
- **`Wallet balance is insufficient` (402).** Add credits to your Thordata wallet before purchasing.
- **Test credential fails.** Check the API key and that the SERP Endpoint is reachable; note that a successful test consumes one credit.

## Get started in minutes

1. **Create a Thordata account** and grab your API key at [thordata](https://www.thordata.com/?ls=n8n&lk=n8n).
2. **Install the node** in self-hosted n8n (see [Installation](#installation)).
3. **Build your first workflow** — add the Thordata node, pick *SERP API* or *Dataset*, and pull live search results or a structured dataset in a couple of clicks.

Ready to put web data on autopilot? **[Get your API key →](https://www.thordata.com/?ls=n8n&lk=n8n)**

## Explore more Thordata integrations

Prefer a different surface? Thordata ships the same SERP and dataset capabilities across your stack:

- **Thordata MCP Server** — give MCP-compatible AI agents live search, history and statistics. See the [Thordata documentation](https://doc.thordata.com).
- **SERP API & SDKs** — call Thordata directly from your application. See [doc.thordata.com](https://doc.thordata.com) for guides and references.

## Support and license

- **Documentation:** [doc.thordata.com](https://doc.thordata.com) · **Contact:** support@thordata.com
- **Feedback:** open an issue on this repository.
- **License:** MIT License. See [LICENSE](LICENSE).
