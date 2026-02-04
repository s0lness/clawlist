#!/usr/bin/env node
"use strict";

const http = require("http");
const https = require("https");

const GATEWAY_URL = process.env.GATEWAY_URL || "http://localhost:3333";
const ACCESS_TOKEN = process.env.GATEWAY_TOKEN || "";
const MATCHMAKER_ID = process.env.MATCHMAKER_ID || "matchmaker";

if (!ACCESS_TOKEN) {
  console.error("GATEWAY_TOKEN is required.");
  process.exit(1);
}

const headers = { Authorization: `Bearer ${ACCESS_TOKEN}` };

function requestJson(url, method, body) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const client = target.protocol === "https:" ? https : http;
    const req = client.request(
      {
        method,
        hostname: target.hostname,
        port: target.port,
        path: target.pathname + target.search,
        headers: {
          ...headers,
          "Content-Type": "application/json",
        },
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => {
          data += chunk.toString("utf8");
        });
        res.on("end", () => resolve({ status: res.statusCode || 0, data }));
      }
    );
    req.on("error", reject);
    req.write(JSON.stringify(body));
    req.end();
  });
}

function startSse(url, onEvent) {
  const target = new URL(url);
  const client = target.protocol === "https:" ? https : http;
  const req = client.request(
    {
      method: "GET",
      hostname: target.hostname,
      port: target.port,
      path: target.pathname + target.search,
      headers,
    },
    (res) => {
      res.setEncoding("utf8");
      let buffer = "";
      res.on("data", (chunk) => {
        buffer += chunk;
        let idx;
        while ((idx = buffer.indexOf("\n\n")) !== -1) {
          const raw = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);
          const lines = raw.split(/\r?\n/);
          let eventName = "message";
          let dataLine = "";
          for (const line of lines) {
            if (line.startsWith("event:")) {
              eventName = line.slice("event:".length).trim();
            } else if (line.startsWith("data:")) {
              dataLine += line.slice("data:".length).trim();
            }
          }
          if (!dataLine) continue;
          try {
            const payload = JSON.parse(dataLine);
            onEvent(eventName, payload);
          } catch (_err) {
            // ignore malformed events
          }
        }
      });
    }
  );
  req.on("error", () => {});
  req.end();
}

function normalize(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseListingFromBody(body) {
  const trimmed = String(body || "").trim();
  const prefixes = ["INTENT ", "LISTING_CREATE "];
  const prefix = prefixes.find((p) => trimmed.startsWith(p));
  if (!prefix) return null;
  const raw = trimmed.slice(prefix.length).trim();
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (_err) {
    return null;
  }
}

const listings = new Map(); // id -> listing
const sentMatches = new Set(); // key buyer_id|listing_id

function upsertListing(payload) {
  const listing = payload.listing || parseListingFromBody(payload.body);
  if (!listing || !listing.id) return null;
  listings.set(listing.id, {
    ...listing,
    agent_id: payload.agent_id || listing.agent_id || "",
  });
  return listings.get(listing.id);
}

function matchListings(newListing) {
  if (!newListing) return;
  const side = newListing.type || newListing.side;
  if (!side) return;
  const itemKey = normalize(newListing.item || newListing.detail || newListing.category);
  if (!itemKey) return;

  for (const listing of listings.values()) {
    const listingSide = listing.type || listing.side;
    if (!listingSide || listing.id === newListing.id) continue;
    if (normalize(listing.item || listing.detail || listing.category) !== itemKey) continue;
    if (listingSide === side) continue;

    const buyer = listingSide === "buy" ? listing : newListing;
    const seller = listingSide === "sell" ? listing : newListing;

    const key = `${buyer.agent_id}|${seller.id}`;
    if (sentMatches.has(key)) continue;

    sentMatches.add(key);
    const summary = {
      listing_id: seller.id,
      seller_agent: seller.agent_id,
      buyer_agent: buyer.agent_id,
      item: seller.item,
      price: seller.price,
      currency: seller.currency,
      condition: seller.condition,
    };

    const message = `MATCH_FOUND ${JSON.stringify(summary)}`;
    requestJson(`${GATEWAY_URL}/dm`, "POST", {
      to_agent: buyer.agent_id,
      body: message,
      from_agent: MATCHMAKER_ID,
    }).catch(() => {});
  }
}

startSse(`${GATEWAY_URL}/gossip/stream`, (event, payload) => {
  if (event !== "gossip") return;
  const listing = upsertListing(payload);
  if (!listing) return;
  matchListings(listing);
});

console.log(`Matchmaker listening on ${GATEWAY_URL}/gossip/stream`);
