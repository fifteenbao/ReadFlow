# Install and deploy ReadFlow

[简体中文](SETUP.md) · [Project overview](README.en.md) · [Configure with an agent](#instructions-for-the-configuring-agent) · [Upgrade an existing server](#upgrade-an-existing-server)

Deploy your ReadFlow service and pair Chrome before saving. For help, give your agent the repository and this guide.

## 1. Initialize the database

Use a single-machine POSIX environment and Node.js **22.13+**, with built-in `node:sqlite`. No npm dependencies are needed. Some Node versions display an SQLite experimental warning. For a new installation, run these commands from the repository root. For an existing deployment, see [upgrading an existing server](#upgrade-an-existing-server).

```sh
mkdir -m 700 private
cp server/host.example.json private/host.json
chmod 600 private/host.json
```

Edit these fields in `private/host.json`. Keep real configuration and credentials in your private directory.

| Field | Purpose |
| --- | --- |
| `baseUrl` | Full HTTPS address, including its path prefix |
| `extensionId` | Chrome's 32-character extension ID using a–p. Set it after installation to enable pairing |
| `stateDir` | Private database directory, for example `./state`. The path is relative to the config file. The HTTP service and tasks use the same directory |
| `connector.storageProvider` | Set to `database` |
| `connector.language` | Default language, `zh` or `en` |

```sh
node server/run.mjs init private/host.json
node server/run.mjs check private/host.json
node server/run.mjs audit private/host.json
```

Initialization creates `state/readflow.sqlite` and a stable library identity without replacing existing data. SQLite stores materials, pairings and task state; `state.json` is used only for initialization/permission checks. Directories must be 0700 and files 0600, owned by the service uid, with no symlinks or multiple hard links (`nlink=1`). `audit` checks private directory permissions. `check` checks the database.

## 2. Connect HTTPS

Mount `createHost(config).handleRequest` on an existing HTTPS service, or explicitly start the loopback reference service behind an existing HTTPS proxy:

```sh
node server/serve.mjs private/host.json
```

The reference service listens on `127.0.0.1:8787` by default. Set `port` to change it. Keep the loopback port local and expose the service through your existing HTTPS proxy.

- Preserve the full request path, `Origin`, `Content-Type`, and `X-ReadFlow-*` signature headers. Allow POST and OPTIONS. Keep request bodies and signature headers out of logs.
- Enforce a 20 MiB request body limit and disable caching of authenticated responses.
- Run HTTP and processing tasks under the same unprivileged account and configuration. Restart after configuration changes.

## 3. Install and pair Chrome

Follow [installation](README.en.md#install-the-chrome-extension). Put the actual extension ID shown at `chrome://extensions` in the server's `extensionId` and restart.

**Keep the installation folder fixed. Moving it may change the extension ID, requiring an allowlist update to avoid `403 ORIGIN_DENIED`. An extension ID is not an authentication key.**

In settings, enter the HTTPS endpoint. Step 2 connects and obtains a fingerprint after granting access to that host. Give the confirmation task to the service administrator. Verify the full fingerprint and extension ID before approving:

```sh
node server/run.mjs pair-list private/host.json
node server/run.mjs pair-approve private/host.json --pair-id REQUEST_ID --fingerprint DISPLAYED_HEX
```

After server approval, the extension automatically verifies and saves the connection. Keep Settings open; reopening resumes a pending check. Network failures show automatic retry feedback. If the request expires or changes, obtain a new fingerprint and give the new task to the administrator. No spreadsheet link or model key is needed. Save a test link within the user's authorized scope and verify database synchronization and CSV.

### Reject or revoke browser pairing

The service administrator can run these commands on the service device:

```sh
node server/run.mjs pair-reject private/host.json --pair-id YOUR_PAIR_REQUEST_ID
node server/run.mjs pair-revoke private/host.json --pair-id YOUR_APPROVED_PAIR_ID
```

Pending requests expire after ten minutes. The browser pairing scope allows up to three pending requests and sixteen approved devices. Request a new fingerprint if a request expires. Reinstalling the extension, changing Chrome profiles, or changing the service address may require pairing again.

The browser stores its private key locally. The server keeps the public key. Run `pair-revoke` on the service device to invalidate signed requests from that browser. Protect your Chrome profile.

## 4. Export CSV

“Download CSV” refreshes and exports all database materials: title, link, reading state, saved time, tags, note, time marked read, purpose, type, star, their sources, and the folder path.

## Backups, operations, and upgrades

Pause the HTTP service and write tasks before backing up. Copy the full private state directory, configuration, environment files, and pairing identities. Preserve ownership and permissions. Use that full backup to restore pairing or task state. CSV is for exporting saved items.

SQLite uses FULL synchronous commits and DELETE journaling. A cross-process lock protects writes. `state.lock` records the owner pid; if that process has exited, the next acquire clears the stale lock automatically, otherwise it returns LOCK_BUSY. Use `audit` and `inbox-pending` for diagnosis; retain Feishu intake delivery receipts when needed. The reference service runs on a single machine and supports up to 10,000 saved items.

External link intake is configured separately. See the [optional link intake (Chinese)](docs/ARCHITECTURE.md#可选链接收录). If intake is enabled, schedule `node server/run.mjs ingest private/host.json --env private/host.env` with user authorization and the same config, `stateDir`, account, and environment.

### Upgrade an existing server

1. Record the current commit and startup method, check for local changes, pause writes, and back up the service.
2. Update to the target version, verify that `package.json` and `manifest.json` agree, and run `npm test`, `npm run security`, and `npm run doctor -- --config private/host.json`.
3. Restart with the original configuration, `stateDir`, account, HTTPS path prefix, and process manager. Keep the existing database and pairing identities. If your deployment still uses the previous directory, update the startup command to `node server/serve.mjs` and existing jobs to `node server/run.mjs`, keeping their arguments.
4. Verify HTTPS, browser pairing, existing items and read timestamps, and CSV in the deployed environment. With matching extension and server code, verify folder creation and moves.
5. If a rollback is needed, retain diagnostics, pause writes, and restore the required code and state from backup. Account for items created since the upgrade.

## Instructions for the configuring agent

Read `AGENTS.md` and this guide first.

1. Inspect only relevant runtime, HTTPS, private storage and scheduler capabilities. Do not scan unrelated credentials. Ask before introducing platforms, accounts or costs.
2. Follow initialization, checks, installation and pairing in order. Verify full fingerprints; never reset the database to conceal failures.
3. Within authorization, verify deduplication, tag/note edits, save failure without local persistence when disconnected, unread/read transitions, folder creation and moves, and CSV exports. Distinguish mocks from actual deployment checks.
4. If the user separately requests agent API verification, check access to the HTTPS service and signature support, then verify [agent pairing and queries](#agent-access-and-pairing).
5. Report the endpoint, fixed installation folder, verification results, backup location and remaining work. Assisting setup does not mean AI reviews are integrated.

## Agent access and pairing

Use these steps to verify that an existing agent can read the library. The agent reading-review workflow is pending.

The agent runtime must reach the full service HTTPS URL and be able to run the bundled signing helper (Node.js 22.13+) or implement the same [signed HTTP protocol](docs/ARCHITECTURE.md#agent-签名). Configure the proxy to forward `v1/agent/*` paths and signature headers. Pair the browser and the agent independently.

On the **agent runtime**, run these commands from the repository root. Replace the example address with the full URL of your service. If you already have an `agent.json`, skip `init` and reuse that identity.

```sh
mkdir -p private
chmod 700 private
node server/agent-client.mjs init private/agent.json https://connection.example.com/readflow/
node server/agent-client.mjs pair private/agent.json
```

The helper stores the private key in `agent.json` with mode 0600. Give the administrator the pairing ID and full fingerprint. The administrator verifies both before approving on the **ReadFlow service device**:

```sh
node server/run.mjs agent-pair-list private/host.json
node server/run.mjs agent-pair-approve private/host.json --pair-id 'PAIR_ID' --fingerprint 'FULL_FINGERPRINT'
```

Replace the placeholders with the verified values. Requests expire after ten minutes. Run `pair` again with the same identity if needed. Once approved, run `node server/agent-client.mjs query private/agent.json` in the agent runtime and check for a test item saved within the last 30 days.

An approved agent can read the entire library, including notes, and can append confirmed reviews through the API. Approve only a runtime you trust. To revoke access, run `node server/run.mjs agent-pair-revoke private/host.json --pair-id 'PAIR_ID'` on the service device.

## Verify completion

Confirm that a Chrome capture reaches the database, keeps the correct metadata and reading status, and appears in CSV. Record agent pairing and query results separately if API verification was requested.
