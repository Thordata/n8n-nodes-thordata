# n8n-nodes-thordata

`n8n-nodes-thordata` v0.1.1 is an n8n SERP API community node for Thordata.

## Installation

This is an unverified community node. Unverified community nodes are not available on n8n Cloud, so both installation paths below are for self-hosted n8n.

### GUI (self-hosted)

As the n8n instance Owner or Admin, open **Settings > Community Nodes**, select **Install**, enter `n8n-nodes-thordata`, accept the community-node risk, and install it.

### Manual (self-hosted)

Open a shell in the environment where n8n runs, then install the package in n8n's nodes directory:

```sh
mkdir -p ~/.n8n/nodes
cd ~/.n8n/nodes
npm install n8n-nodes-thordata
```

Restart n8n after a manual installation. For Docker, run these commands inside the n8n container (for example, after opening a shell with `docker exec`) and persist the `.n8n/nodes` directory across container replacement.

See n8n's [official community-node installation and management documentation](https://docs.n8n.io/integrations/community-nodes/installation-and-management/) for current platform requirements and removal or upgrade instructions.

## Credentials

Create a **Thordata API** credential with:

- **API Key**: a required password field.
- **SERP Endpoint**: defaults to `https://scraperapi.thordata.com/request`.

There is no automatic credential test because live validation consumes a SERP request and may consume credit. The Bearer API Key is sent to the configured SERP Endpoint. Only credential administrators should change that endpoint; use a trusted internal/development endpoint when overriding it.

## Usage

1. Add the **Thordata** node to a workflow.
2. Select the only v0.1.1 **Resource**, **SERP API**.
3. Select one of the dynamically loaded engines under **Operation**.
4. Fill the dynamically loaded **Parameters**. The editor exposes schema fields where `visible=true` for the `is_serp_old=0` audience. Hidden fields are not displayed and are not defaulted.
5. Expand the collapsed **Options** collection when needed and provide **Extra Parameters JSON** as a JSON object.

Request values are applied in this order: visible defaults -> mapped values -> Extra JSON -> protected controls. Extra JSON may override normal fields and hidden fields, but it can never override `engine` or `isjson`. The node fixes `isjson=1`; `json` defaults to `'1'` when it is otherwise absent. For engines that expose Encoded Location, a read-only field refreshes from the mapped `location`; execution also derives UULE from a Latin-1 `location` when it is absent. Country restriction (`cr`) values accept country codes.

## Output and errors

Successful items have this stable shape; `taskId` is optional when the upstream response does not provide one:

```json
{
  "engine": "google",
  "query": "n8n",
  "taskId": "example-task-id",
  "result": {}
}
```

A missing query is returned as `null`, and `result` is always JSON-safe. Business errors fail the node. n8n's **Continue On Fail** setting is supported and returns an error item for the affected input.

## Schema reliability

The schema is fetched from a fixed public URL; no API key is used in the schema call. Editor loads are fresh. Execution uses a 5-minute in-memory cache, then a last success or bundled snapshot fallback with 34 engines. There is no database or workflow persistence.

No key is written to the schema call, snapshot, or logs. There is no automatic credential test. Treat a custom SERP Endpoint as a security-sensitive credential setting and use only a trusted internal/development endpoint.

## Version scope

v0.1.1 does not expose Web Scraper. A later version may add another resource without changing existing `resource=serp` workflows.

## License

MIT License. See [LICENSE](LICENSE).
