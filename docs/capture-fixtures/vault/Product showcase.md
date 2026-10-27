# HTTP caching

Keep a response while it is fresh. Validate it when freshness expires.

%% tabs %%
%% tab: icon:layers Concept %%

## Reuse or revalidate

> [!tip] Freshness and validation are different
> `max-age` controls reuse. An `ETag` lets the server check whether content changed.

| Cached response | Next request          | Result              |
| --------------- | --------------------- | ------------------- |
| Still fresh     | Reuse the stored body | No network request  |
| Stale, same tag | Send `If-None-Match`  | `304 Not Modified`  |
| Stale, new tag  | Send `If-None-Match`  | `200` with new body |

%% tabs %%
%% tab: Unchanged %%

```http
GET /notes/42 HTTP/1.1
If-None-Match: "note-v3"

HTTP/1.1 304 Not Modified
```

%% tab: Changed %%

```http
HTTP/1.1 200 OK
ETag: "note-v4"
Cache-Control: private, max-age=60
```

%% endtabs %%

%% tab: icon:list-filter Headers %%

## The cache contract

| Header          | Responsibility                         |
| --------------- | -------------------------------------- |
| `Cache-Control` | Freshness and storage rules            |
| `ETag`          | Validator for a representation         |
| `Vary`          | Request headers that affect cache keys |

```http
Cache-Control: private, max-age=60
ETag: "note-v3"
Vary: Accept-Encoding
```

> [!note] Storage is a separate choice
> `no-cache` requires validation before reuse. `no-store` prohibits storage.

%% tab: icon:code Example %%

## Conditional request

```http
GET /notes/42 HTTP/1.1
Accept: application/json
If-None-Match: "note-v3"
```

If the selected representation still matches, the server returns `304` without a response body. Otherwise it sends the current representation with `200` and a new validator.

%% endtabs %%

**Related:** cache keys · shared caches · conditional updates
