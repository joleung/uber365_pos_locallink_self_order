# GOLOCALLINK API Documentation

## Overview

GOLOCALLINK is a payment gateway bridge service that interfaces between Odoo (ERP system) and PAX payment terminals. It provides RESTful APIs and Server-Sent Events (SSE) for real-time transaction processing and status updates.

**Version:** 1.0.0
**Protocol:** HTTP/HTTPS
**Data Format:** JSON

## Base URL

The API is hosted on a configurable port (default: 8080) and can run with or without SSL:

```
# Without SSL
http://localhost:8080

# With SSL
https://localhost:8080
```

Configuration is managed via `config.yaml`.

## Authentication

The API currently does not require authentication for client requests. However, communication with PAX terminals uses Bearer token authentication (configured in `config.yaml`).

## CORS Policy

The API enforces CORS restrictions based on allowed origins configured in `config.yaml`:

```yaml
odoo:
  allowed_origins:
    - "http://odoo-host:8069"
    - "http://localhost:8069"
```

## API Endpoints

### 1. Create SALE Transaction (SSE-based) - **Recommended**

Initiates a new SALE transaction and returns transaction details. The client should then connect to the SSE endpoint to receive real-time status updates.

**Endpoint:** `POST /api/sse/txn/sale`

**Request Headers:**
```
Content-Type: application/json
```

**Request Body:**
```json
{
  "termid": "",
  "amttxn": 100,
  "ref": ""
}
```

**Request Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| termid | string | No | Terminal ID (currently unused, reserved for future multi-terminal support) |
| amttxn | integer | Yes | Transaction amount in cents (e.g., 100 = $1.00) |
| ref | string | No | Reference identifier (reserved for future use) |

**Success Response (201 Created):**
```json
{
  "amountCashback": 0.0,
  "amountGratuity": 0.0,
  "amountTrans": 1.00,
  "transType": "SALE",
  "uti": "UUID-STRING-HERE"
}
```

**Response Fields:**

| Field | Type | Description |
|-------|------|-------------|
| amountCashback | float | Cashback amount (always 0 for SALE transactions) |
| amountGratuity | float | Gratuity/tip amount (always 0 for SALE transactions) |
| amountTrans | float | Transaction amount in dollars |
| transType | string | Transaction type (always "SALE") |
| uti | string | Universal Transaction Identifier - use this to connect to SSE endpoint |

**Error Response (503 Service Unavailable):**
```json
{
  "error": "Terminal health check failed",
  "error_code": "HEALTH_CHECK_FAILED"
}
```

**Error Response (400 Bad Request):**
```json
{
  "error": "invalid request body"
}
```

**Example:**
```bash
curl -X POST http://localhost:8080/api/sse/txn/sale \
  -H "Content-Type: application/json" \
  -d '{"termid":"","amttxn":1500,"ref":""}'
```

---

### 2. SSE Event Stream for Transaction Status

Establishes a Server-Sent Events connection to receive real-time transaction status updates for a specific transaction.

**Endpoint:** `GET /api/events/:uti`

**URL Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| uti | string | Yes | Universal Transaction Identifier from transaction creation response |

**Response Headers:**
```
Content-Type: text/event-stream
Cache-Control: no-cache
Connection: keep-alive
X-Accel-Buffering: no
```

**SSE Message Format:**

Each SSE message is sent in the format:
```
data: <JSON>\n\n
```

**Initial Connection Message:**
```json
{
  "status_code": "connected",
  "uti": "UUID-STRING-HERE"
}
```

**Status Update Messages:**

| Status Code | Description | Message Format |
|-------------|-------------|----------------|
| 206 | Transaction in progress | `{"status_code":"206","uti":"..."}` |
| 200A | Transaction approved | `{"status_code":"200A","bank_id_no":"453212","card_no_4digit":"9012","auth_code":"AUTH123","uti":"...","cardholder_receipt":"...","merchant_receipt":"..."}` |
| 200N | Transaction not approved/declined | `{"status_code":"200N","uti":"..."}` |
| 500 | Transaction error | `{"status_code":"500","uti":"...","error_code":"ERROR_CODE","error_message":"Error description"}` |
| 000 | Reset status (connection closes after this) | `{"status_code":"000","uti":"..."}` |

**Approved Transaction Fields:**

| Field | Type | Description |
|-------|------|-------------|
| status_code | string | "200A" for approved transactions |
| bank_id_no | string | First 6 digits of card number (BIN) |
| card_no_4digit | string | Last 4 digits of card number |
| auth_code | string | Authorization code from card issuer |
| uti | string | Universal Transaction Identifier |
| cardholder_receipt | string | Formatted cardholder receipt (plain text) |
| merchant_receipt | string | Formatted merchant receipt (plain text) |

**Error Response Fields:**

| Field | Type | Description |
|-------|------|-------------|
| status_code | string | "500" for errors |
| uti | string | Universal Transaction Identifier |
| error_code | string | Error code constant (see Error Codes section) |
| error_message | string | Human-readable error description |

**Transaction Flow via SSE:**

1. Client receives `connected` message confirming SSE connection
2. Client receives `206` message indicating transaction is in progress
3. Client receives either:
   - `200A` with card details if approved
   - `200N` if declined/timeout
   - `500` if error occurred
4. After 8 seconds, client receives `000` message (reset status)
5. SSE connection automatically closes after reset message

**Example (JavaScript):**
```javascript
const uti = "received-from-post-response";
const eventSource = new EventSource(`http://localhost:8080/api/events/${uti}`);

eventSource.onmessage = function(event) {
  const data = JSON.parse(event.data);
  console.log('Status:', data.status_code);

  if (data.status_code === '200A') {
    console.log('Approved! Card:', data.bank_id_no + '...' + data.card_no_4digit);
    console.log('Auth Code:', data.auth_code);
  } else if (data.status_code === '200N') {
    console.log('Transaction declined');
  } else if (data.status_code === '000') {
    console.log('Transaction complete');
    eventSource.close();
  }
};

eventSource.onerror = function(error) {
  console.error('SSE Error:', error);
  eventSource.close();
};
```

---

### 3. Create SALE Transaction (Legacy)

Legacy endpoint for initiating SALE transactions. Uses SSE internally but requires separate connection management.

**Endpoint:** `POST /api/txn/sale`

**Request/Response:** Same as `/api/sse/txn/sale`

**Note:** This endpoint is maintained for backward compatibility. New integrations should use `/api/sse/txn/sale` instead.

---

### 4. Get Transaction Status

Retrieves the final transaction result from the database by UTI.

**Endpoint:** `GET /api/txn/:txnId`

**URL Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| txnId | string | Yes | Universal Transaction Identifier (UTI) |

**Success Response (200 OK) - Transaction Found:**

Returns the full PAX terminal response (decrypted from database):

```json
{
  "transApproved": true,
  "transCancelled": false,
  "transactionType": "SALE",
  "totalAmount": "15.00",
  "primaryAccountNumber": "453212******9012",
  "authCode": "AUTH123",
  "uti": "UUID-STRING-HERE",
  ...additional PAX terminal fields...
}
```

**Success Response (200 OK) - Transaction In Progress:**

If transaction is not yet complete:

```json
{
  "status_code": "206",
  "status": "Transaction in progress"
}
```

**Error Response (500 Internal Server Error):**
```json
{
  "error": "Database connection failed"
}
```

**Example:**
```bash
curl http://localhost:8080/api/txn/550e8400-e29b-41d4-a716-446655440000
```

---

### 5. Cancel Transaction

Cancels an ongoing transaction on the PAX terminal.

**Endpoint:** `POST /api/txn/cancel`

**Request Body:** None required

**Success Response (200 OK):**
```json
{
  "status": "Transaction cancellation requested"
}
```

**Note:** This sends a cancellation request to the PAX terminal. The actual cancellation is processed asynchronously.

**Example:**
```bash
curl -X POST http://localhost:8080/api/txn/cancel
```

---

### 6. Static HTML Files

Serves static HTML content for testing or UI purposes.

**Endpoint:** `GET /html/*`

**Example:**
```bash
curl http://localhost:8080/html/test.html
```

---

## Transaction Status Codes

Status codes sent via SSE to indicate transaction state:

| Code | Description | Final State |
|------|-------------|-------------|
| connected | SSE connection established | No |
| 206 | Transaction in progress (waiting for card input) | No |
| 200A | Transaction approved | Yes |
| 200N | Transaction not approved/declined/timeout | Yes |
| 500 | Transaction error occurred | Yes |
| 000 | Reset status (UI should reset) | Yes |

---

## Error Codes

Error codes returned in error responses:

| Error Code | Description | HTTP Status |
|------------|-------------|-------------|
| TERMINAL_UNREACHABLE | Cannot connect to PAX terminal | 503 |
| HEALTH_CHECK_FAILED | Terminal failed health check before transaction | 503 |
| CIRCUIT_BREAKER_OPEN | Circuit breaker is open due to too many terminal failures | 503 |
| NETWORK_ERROR | Network error communicating with terminal | 503 |
| API_ERROR | PAX API returned an error | 503 |
| INVALID_RESPONSE | Invalid or malformed response from terminal | 500 |
| INVALID_REQUEST | Invalid request format | 400 |
| UNKNOWN_ERROR | Unknown error occurred | 500 |

---

## Transaction Processing Timeline

Understanding the transaction lifecycle and timing:

1. **Transaction Initiation (T+0s):**
   - Client sends POST to `/api/sse/txn/sale`
   - Server posts transaction to PAX terminal
   - Server returns UTI to client immediately

2. **Initial Status (T+0s):**
   - Client connects to `/api/events/:uti`
   - Receives `connected` message
   - Receives `206` (in progress) message

3. **Waiting Period (T+0s to T+10s):**
   - Server waits 10 seconds before first status poll
   - No SSE updates sent during this period

4. **Active Polling (T+10s to T+120s):**
   - Server polls PAX terminal every 5 seconds
   - Sends `206` status updates via SSE
   - Customer is interacting with PAX terminal (card insertion, PIN entry, etc.)

5. **Transaction Complete (variable timing):**
   - PAX returns final result (approved or declined)
   - Server sends `200A` (approved) or `200N` (not approved) via SSE
   - Server encrypts and stores transaction in database

6. **Status Reset (T+completion+8s):**
   - Server sends `000` status to reset UI
   - SSE connection closes 1 second later

7. **Timeout Scenario (T+120s):**
   - If no response after 2 minutes, server stops polling
   - Sends `200N` (not approved) status
   - Follows normal completion flow

---

## Complete Transaction Example

### Step 1: Initiate Transaction

**Request:**
```bash
POST /api/sse/txn/sale HTTP/1.1
Host: localhost:8080
Content-Type: application/json

{
  "termid": "",
  "amttxn": 2500,
  "ref": ""
}
```

**Response:**
```json
HTTP/1.1 201 Created
Content-Type: application/json

{
  "amountCashback": 0.0,
  "amountGratuity": 0.0,
  "amountTrans": 25.00,
  "transType": "SALE",
  "uti": "550e8400-e29b-41d4-a716-446655440000"
}
```

### Step 2: Connect to SSE Stream

**Request:**
```
GET /api/events/550e8400-e29b-41d4-a716-446655440000 HTTP/1.1
Host: localhost:8080
Accept: text/event-stream
```

**Response Stream:**
```
HTTP/1.1 200 OK
Content-Type: text/event-stream
Cache-Control: no-cache
Connection: keep-alive

data: {"status_code":"connected","uti":"550e8400-e29b-41d4-a716-446655440000"}

data: {"status_code":"206","uti":"550e8400-e29b-41d4-a716-446655440000"}

data: {"status_code":"206","uti":"550e8400-e29b-41d4-a716-446655440000"}

data: {"status_code":"200A","bank_id_no":"453212","card_no_4digit":"9012","auth_code":"AUTH123456","uti":"550e8400-e29b-41d4-a716-446655440000","cardholder_receipt":"MERCHANT NAME\n...\nAPPROVED","merchant_receipt":"MERCHANT NAME\n...\nAPPROVED"}

data: {"status_code":"000","uti":"550e8400-e29b-41d4-a716-446655440000"}

[Connection closed]
```

### Step 3: Retrieve Transaction (Optional)

**Request:**
```bash
GET /api/txn/550e8400-e29b-41d4-a716-446655440000 HTTP/1.1
Host: localhost:8080
```

**Response:**
```json
HTTP/1.1 200 OK
Content-Type: application/json

{
  "transApproved": true,
  "transCancelled": false,
  "transactionType": "SALE",
  "totalAmount": "25.00",
  "primaryAccountNumber": "453212******9012",
  "authCode": "AUTH123456",
  "uti": "550e8400-e29b-41d4-a716-446655440000",
  "cardType": "VISA",
  "entryMode": "CHIP",
  ...
}
```

---

## Security Considerations

### Data Storage

- All transaction responses are encrypted using **AES-GCM** (Galois/Counter Mode) before storage
- Encryption key is loaded from `hello.ini` file (16, 24, or 32 bytes for AES-128/192/256)
- Each encryption uses a unique 12-byte cryptographically secure random nonce
- GCM mode provides both confidentiality and authentication

### Card Number Handling

The API follows PCI DSS guidelines for card number display:
- Only first 6 digits (BIN - Bank Identification Number) are returned
- Only last 4 digits are returned
- Full card number is never transmitted to clients
- Format: `bank_id_no` (first 6) + `card_no_4digit` (last 4)

### PAX Terminal Communication

- HTTPS communication with PAX terminals
- Bearer token authentication (configured per terminal)
- `InsecureSkipVerify` option available for testing environments (should be `false` in production)

### CORS Protection

- Only configured origins can access the API
- Credentials are allowed for configured origins
- Prevents unauthorized cross-origin requests

---

## Error Handling

### Terminal Failures

The system includes a **circuit breaker pattern** to protect against repeated terminal failures:

- Circuit opens after **5 consecutive failures**
- Remains open for **30 seconds**
- Returns `CIRCUIT_BREAKER_OPEN` error during open state
- Automatically tries again after timeout

### Health Checks

- Health check is performed before every transaction POST
- Health check results are cached for 30 seconds
- If health check fails, transaction is rejected immediately
- Returns `HEALTH_CHECK_FAILED` error code

### Retry Logic

- HTTP requests to PAX terminal include exponential backoff retry
- Maximum **3 retry attempts**
- Base delay: 1 second, doubling with each retry (1s, 2s, 4s)
- Only retries on network errors, not on terminal rejections

### Transaction Polling Errors

- Tolerates up to **5 consecutive polling errors**
- Continues polling if PAX returns partial responses
- Sends error notification via SSE if consecutive errors exceed threshold
- Returns `INVALID_RESPONSE` error code

---

## Timeouts

| Operation | Timeout | Description |
|-----------|---------|-------------|
| HTTP Request | 10 seconds | Individual HTTP request to PAX terminal |
| Initial Wait | 10 seconds | Wait before first status poll |
| Polling Interval | 5 seconds | Interval between status polls |
| Max Polling | 2 minutes | Maximum transaction polling duration |
| Status Reset Delay | 8 seconds | Delay before sending reset status |
| Health Check Cache | 30 seconds | Cache duration for health check results |
| Circuit Breaker | 30 seconds | Time circuit remains open after failures |

---

## Receipt Format

Receipts are returned as plain text strings with newline characters separating lines. The PAX terminal returns receipts in a structured array format, which GOLOCALLINK converts to readable text.

**Original PAX Format:**
```json
[
  ["MERCHANT NAME", 2, "C", "B"],
  ["123 MAIN ST", 1, "C", "N"],
  ["", 1, "C", "N"],
  ["SALE", "APPROVED", 1, "S", "B"]
]
```

**Converted Format:**
```
MERCHANT NAME
123 MAIN ST

SALE APPROVED
```

Array format elements:
- Index 0: Text content (or first text for split format)
- Index 1: Font size (or second text for split format)
- Index 2: Alignment (C=center, L=left, R=right, S=split)
- Index 3: Style (B=bold, N=normal)

---

## Testing

### Health Check Endpoint

While not exposed as a public API endpoint, you can verify terminal connectivity by initiating a transaction. If the terminal is unreachable, you'll receive an immediate error response instead of a transaction UTI.

### Test Transaction Flow

Use the static HTML interface for manual testing:

```bash
# Access test interface
curl http://localhost:8080/html/test.html
```

Or use the integration tests:

```bash
go test -v ./...
```

---

## Monitoring and Logging

The application uses structured logging with the following fields:

- `uti`: Universal Transaction Identifier
- `terminal_id`: Terminal ID from configuration
- `terminal_ip`: Terminal IP address and port
- `operation`: Operation type (POST, GET, POLL, CANCEL, CHECK)
- `amount`: Transaction amount (when applicable)
- `status_code`: HTTP status code
- `approved`: Transaction approval status

Log levels:
- `DEBUG`: Detailed transaction flow and SSE events
- `INFO`: Transaction lifecycle events (created, completed)
- `WARN`: Recoverable errors, terminal unreachable warnings
- `ERROR`: Transaction failures, encryption errors, database errors
- `FATAL`: Application startup failures (missing encryption key, etc.)

---

## Version History

**1.0.0** - Initial release
- SSE-based transaction status updates
- SALE transaction support
- AES-GCM encryption for stored transactions
- Circuit breaker pattern for terminal failures
- Health checks before transaction posting
- Retry logic with exponential backoff

---

## Support

For issues, bug reports, or feature requests, please refer to the project repository or contact the development team.
