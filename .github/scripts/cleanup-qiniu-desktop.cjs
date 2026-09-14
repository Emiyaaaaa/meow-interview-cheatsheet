#!/usr/bin/env node
"use strict";

const qiniu = require("qiniu");

const PREFIX = (process.env.QINIU_PREFIX || "desktop").replace(/\/$/, "");
const CURRENT_VERSION = String(process.env.VERSION || "")
  .trim()
  .replace(/^v/i, "");
const ACCESS_KEY = process.env.QINIU_ACCESS_KEY || "";
const SECRET_KEY = process.env.QINIU_SECRET_KEY || "";
const BUCKET = process.env.QINIU_BUCKET || "";
const BATCH_SIZE = 200;

if (!ACCESS_KEY || !SECRET_KEY || !BUCKET) {
  throw new Error("QINIU_ACCESS_KEY, QINIU_SECRET_KEY, QINIU_BUCKET are required");
}

const mac = new qiniu.auth.digest.Mac(ACCESS_KEY, SECRET_KEY);
const config = new qiniu.conf.Config({ useHttpsDomain: true });
const bucketManager = new qiniu.rs.BucketManager(mac, config);

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : error);
  process.exit(1);
});

async function main() {
  const latest = CURRENT_VERSION || (await githubLatestVersion());
  if (!latest) {
    throw new Error("No latest version to keep; refuse to delete Qiniu objects");
  }

  const items = await listAll(`${PREFIX}/`);
  const toDelete = [];

  for (const item of items) {
    const key = String(item?.key || "");
    if (!key) continue;
    if (versionOf(key) === latest) continue;
    toDelete.push(key);
  }

  console.log(
    `Listed ${items.length} objects under ${PREFIX}/; keep version ${latest}`,
  );

  if (toDelete.length === 0) {
    console.log("No previous installers to delete");
    return;
  }

  for (const key of toDelete) console.log(`Delete ${key}`);
  await deleteKeys(toDelete);
  console.log(`Deleted ${toDelete.length} previous Qiniu installers`);
}

function versionOf(key) {
  const prefix = `${PREFIX}/v`;
  if (!key.startsWith(prefix)) return "";
  const rest = key.slice(prefix.length);
  const slash = rest.indexOf("/");
  return (slash === -1 ? rest : rest.slice(0, slash)).trim();
}

async function githubLatestVersion() {
  const repo = process.env.GITHUB_REPOSITORY;
  const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
  if (!repo) return "";

  try {
    const res = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, {
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": "qiniu-desktop-cleanup",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    });
    if (!res.ok) {
      console.warn(`GitHub latest release HTTP ${res.status}`);
      return "";
    }
    const data = await res.json();
    return String(data.tag_name || "")
      .trim()
      .replace(/^v/i, "");
  } catch (error) {
    console.warn("GitHub latest release lookup failed", error);
    return "";
  }
}

async function listAll(prefix) {
  const items = [];
  let marker = "";

  do {
    const options = { prefix, limit: 1000 };
    if (marker) options.marker = marker;
    const { body, info } = await listPrefix(options);
    if (info.statusCode !== 200) {
      throw new Error(
        `Qiniu listPrefix HTTP ${info.statusCode}: ${JSON.stringify(body)}`,
      );
    }
    items.push(...(body.items || []));
    marker = body.marker || "";
  } while (marker);

  return items;
}

function listPrefix(options) {
  return invokeManager("listPrefix", [BUCKET, options]);
}

async function deleteKeys(keys) {
  for (let index = 0; index < keys.length; index += BATCH_SIZE) {
    const chunk = keys.slice(index, index + BATCH_SIZE);
    const operations = chunk.map((key) => qiniu.rs.deleteOp(BUCKET, key));
    const { body, info } = await batch(operations);
    const status = Math.floor(info.statusCode / 100);
    if (status !== 2) {
      throw new Error(
        `Qiniu batch delete HTTP ${info.statusCode}: ${JSON.stringify(body)}`,
      );
    }
    for (const [offset, result] of (body || []).entries()) {
      if (result?.code === 200 || result?.code === 612) continue;
      throw new Error(
        `Failed to delete ${chunk[offset]}: ${result?.code} ${JSON.stringify(result?.data)}`,
      );
    }
  }
}

function batch(operations) {
  return invokeManager("batch", [operations]);
}

function invokeManager(method, args) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error, body, info) => {
      if (settled) return;
      settled = true;
      if (error) reject(error);
      else resolve({ body, info });
    };

    const maybe = bucketManager[method](...args, (error, body, info) => {
      finish(error, body, info);
    });
    if (maybe && typeof maybe.then === "function") {
      maybe
        .then((result) => {
          if (result && result.resp) finish(null, result.data, result.resp);
        })
        .catch((error) => finish(error));
    }
  });
}
