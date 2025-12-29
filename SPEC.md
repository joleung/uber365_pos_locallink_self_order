# golocallink API Specification

**Version:** 1.0.0
**Last Updated:** 2025-11-18

This document describes the API endpoints for integrating Odoo with PAX payment terminals via the golocallink payment gateway bridge.

## Table of Contents

- [Overview](#overview)
- [Authentication & CORS](#authentication--cors)
- [Base Configuration](#base-configuration)
- [API Endpoints](#api-endpoints)
  - [SSE-based API (Recommended)](#sse-based-api-recommended)
  - [REST API (Legacy)](#rest-api-legacy)
- [Status Codes](#status-codes)
- [Transaction Flow](#transaction-flow)
- [Error Handling](#error-handling)
- [Examples](#examples)

---

## Overview

golocallink provides a bridge between Odoo and PAX payment terminals. It supports two integration patterns:

1. **SSE-based API (Recommended)**: Uses Server-Sent Events for real-time transaction status updates
2. **REST API (Legacy)**: Traditional REST endpoints with polling

The SSE-based approach provides real-time updates without polling and is the recommended integration method for new implementations.

---

## Authentication & CORS

### CORS Configuration

The golocallink server enforces CORS (Cross-Origin Resource Sharing) validation. Configure the allowed Odoo origin in `config.yaml`:

```yaml
odoo:
  url: "http://odoo-host:8069"
```

All API requests from Odoo must originate from this configured URL.

### SSL/TLS

SSL can be enabled in the configuration:

```yaml
ssl:
  enabled: true
  certfile: "ssl.crt"
  keyfile: "ssl.key"
```

When SSL is enabled, use `https://` instead of `http://` for all API calls.

---

## Base Configuration

Default listen port: `8080`

Base URL format:
- HTTP: `http://localhost:8080`
- HTTPS: `https://localhost:8080` (if SSL enabled)

---

## API Endpoints

### SSE-based API (Recommended)

#### 1. Initiate Sale Transaction

**Endpoint:** `POST /api/sse/txn/sale`

**Description:** Initiates a SALE transaction on the PAX terminal and returns a UTI (Universal Transaction Identifier) for tracking.

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
- `termid` (string, optional): Terminal ID (can be empty string, uses config terminal)
- `amttxn` (number, required): Transaction amount in cents (e.g., 100 = $1.00)
- `ref` (string, optional): Reference number for the transaction

**Response:** `200 OK`
```json
{
  "uti": "550e8400-e29b-41d4-a716-446655440000",
  "amountTrans": 100,
  "status": "initiated"
}
```

**Response Fields:**
- `uti` (string): Universal Transaction Identifier - use this to connect to SSE stream
- `amountTrans` (number): Transaction amount in cents
- `status` (string): Initial status (always "initiated")

**Error Response:** `400 Bad Request` or `500 Internal Server Error`
```json
{
  "error": "Error message description"
}
```

---

#### 2. Server-Sent Events Stream

**Endpoint:** `GET /api/events/:uti`

**Description:** Opens an SSE connection to receive real-time transaction status updates for a specific transaction.

**URL Parameters:**
- `uti` (string, required): Universal Transaction Identifier from the sale initiation response

**Request Headers:**
```
Accept: text/event-stream
Cache-Control: no-cache
Connection: keep-alive
```

**Response:** `200 OK` with `Content-Type: text/event-stream`

**SSE Event Format:**
```
data: {"status_code":"206","uti":"550e8400-e29b-41d4-a716-446655440000","bank_id_no":"","card_no_4digit":"","auth_code":""}\n\n
```

**SSE Message Types:**

1. **Connection Established**
```json
{
  "status_code": "connected",
  "uti": "550e8400-e29b-41d4-a716-446655440000"
}
```

2. **Transaction In Progress**
```json
{
  "status_code": "206",
  "uti": "550e8400-e29b-41d4-a716-446655440000",
  "bank_id_no": "",
  "card_no_4digit": "",
  "auth_code": ""
}
```

3. **Transaction Approved**
```json
{
  "status_code": "200A",
  "uti": "550e8400-e29b-41d4-a716-446655440000",
  "bank_id_no": "453212",
  "card_no_4digit": "9012",
  "auth_code": "AUTH123456"
}
```

4. **Transaction Declined/Failed**
```json
{
  "status_code": "200N",
  "uti": "550e8400-e29b-41d4-a716-446655440000",
  "bank_id_no": "",
  "card_no_4digit": "",
  "auth_code": ""
}
```

5. **Reset/Close**
```json
{
  "status_code": "000",
  "uti": "550e8400-e29b-41d4-a716-446655440000",
  "bank_id_no": "",
  "card_no_4digit": "",
  "auth_code": ""
}
```
*Note: Connection closes automatically after sending this message*

**SSE Message Fields:**
- `status_code` (string): Status code (see [Status Codes](#status-codes) section)
- `uti` (string): Universal Transaction Identifier
- `bank_id_no` (string): First 6 digits of card number (BIN - only present on approval)
- `card_no_4digit` (string): Last 4 digits of card number (only present on approval)
- `auth_code` (string): Authorization code from card processor (only present on approval)

**Connection Lifecycle:**
1. Client connects to SSE endpoint
2. Server sends "connected" message
3. Server sends "206" (in progress) when transaction starts on terminal
4. Server polls PAX terminal every 5 seconds (max 2 minutes)
5. Server sends "200A" (approved) or "200N" (declined) when transaction completes
6. Server waits 8 seconds, then sends "000" (reset) and closes connection

---

### REST API (Legacy)

#### 3. Initiate Sale Transaction (Legacy)

**Endpoint:** `POST /api/txn/sale`

**Description:** Legacy endpoint for initiating SALE transactions. Uses SSE internally for status updates.

**Request/Response:** Same as SSE-based `POST /api/sse/txn/sale`

**Note:** For new integrations, use the SSE-based endpoint instead.

---

#### 4. Retrieve Transaction

**Endpoint:** `GET /api/txn/:txnId`

**Description:** Retrieves a completed transaction by its UTI from the database.

**URL Parameters:**
- `txnId` (string, required): Universal Transaction Identifier

**Response:** `200 OK`
```json
{
  "uti": "550e8400-e29b-41d4-a716-446655440000",
  "transaction_type": "SALE",
  "amount": 100,
  "status": "approved",
  "card_number": "******9012",
  "authorization_code": "AUTH123456",
  "timestamp": "2025-11-18T10:30:00Z"
}
```

**Error Response:** `404 Not Found`
```json
{
  "error": "Transaction not found"
}
```

---

#### 5. Cancel Transaction

**Endpoint:** `POST /api/txn/cancel`

**Description:** Cancels an ongoing transaction on the PAX terminal.

**Request Body:** Empty or `{}`

**Response:** `200 OK`
```json
{
  "status": "cancelled"
}
```

**Error Response:** `500 Internal Server Error`
```json
{
  "error": "Failed to cancel transaction"
}
```

**Note:** This endpoint calls `StopTransaction()` on the PAX terminal. It may not work if the transaction has already been completed.

---

## Status Codes

| Status Code | Description | Action Required |
|-------------|-------------|-----------------|
| `connected` | SSE connection established | Wait for transaction status updates |
| `206` | Transaction in progress on terminal | Display "Processing..." to user |
| `200A` | Transaction approved | Record transaction, update order status |
| `200N` | Transaction declined or timed out | Display error, offer retry |
| `000` | Reset signal | Close SSE connection, reset UI |

---

## Transaction Flow

### Recommended SSE Flow

```
Odoo Module                    golocallink                    PAX Terminal
    |                              |                                |
    |--POST /api/sse/txn/sale----->|                                |
    |<----{uti: "xxx"}-------------|                                |
    |                              |                                |
    |--GET /api/events/:uti------->|                                |
    |<----data: {connected}--------|                                |
    |                              |                                |
    |                              |----POST /Transaction---------->|
    |                              |<---{uti: "xxx"}----------------|
    |                              |                                |
    |<----data: {206}--------------|                                |
    |                              |                                |
    |                              |----GET /Transaction/:uti------>| (every 5s)
    |                              |<---{status: "pending"}---------|
    |                              |                                |
    |                              |----GET /Transaction/:uti------>|
    |                              |<---{status: "approved"}--------|
    |                              |                                |
    |<----data: {200A, card, auth}-|                                |
    |                              |                                |
    [8 second delay]               |                                |
    |                              |                                |
    |<----data: {000}--------------|                                |
    [connection closes]            |                                |
```

### Implementation Steps for Odoo

1. **Initiate Transaction:**
   ```javascript
   const response = await fetch('http://localhost:8080/api/sse/txn/sale', {
     method: 'POST',
     headers: { 'Content-Type': 'application/json' },
     body: JSON.stringify({ termid: '', amttxn: 1000, ref: 'ORDER-123' })
   });
   const { uti } = await response.json();
   ```

2. **Open SSE Connection:**
   ```javascript
   const eventSource = new EventSource(`http://localhost:8080/api/events/${uti}`);

   eventSource.onmessage = (event) => {
     const data = JSON.parse(event.data);

     switch(data.status_code) {
       case 'connected':
         console.log('Connected to transaction stream');
         break;
       case '206':
         // Show "Processing payment..." UI
         break;
       case '200A':
         // Transaction approved
         // Save: data.bank_id_no, data.card_no_4digit, data.auth_code
         recordTransaction(uti, data);
         break;
       case '200N':
         // Transaction declined
         showError('Payment declined');
         break;
       case '000':
         // Reset signal - close connection
         eventSource.close();
         resetUI();
         break;
     }
   };

   eventSource.onerror = (error) => {
     console.error('SSE Error:', error);
     eventSource.close();
   };
   ```

3. **Handle Cancellation (Optional):**
   ```javascript
   async function cancelTransaction() {
     await fetch('http://localhost:8080/api/txn/cancel', {
       method: 'POST',
       headers: { 'Content-Type': 'application/json' }
     });
     eventSource.close();
   }
   ```

---

## Error Handling

### HTTP Error Codes

| Code | Description | Common Causes |
|------|-------------|---------------|
| 400 | Bad Request | Invalid JSON, missing required fields |
| 404 | Not Found | Transaction UTI doesn't exist |
| 500 | Internal Server Error | PAX terminal unreachable, database error |

### SSE Connection Errors

- **Connection Timeout**: SSE connection may close if no data sent for extended period
- **Network Interruption**: Implement automatic reconnection with exponential backoff
- **CORS Errors**: Verify Odoo URL is configured in `config.yaml`

### Transaction Timeout

- Transactions timeout after 2 minutes if PAX terminal doesn't respond
- Status code `200N` will be sent on timeout
- Consider implementing a client-side timeout as a fallback

---

## Examples

### Python Example (Odoo Backend)

```python
import requests
import json
import sseclient

def process_payment(amount_cents, reference):
    """Process a payment transaction using SSE"""

    # Step 1: Initiate transaction
    response = requests.post(
        'http://localhost:8080/api/sse/txn/sale',
        json={
            'termid': '',
            'amttxn': amount_cents,
            'ref': reference
        }
    )
    data = response.json()
    uti = data['uti']

    # Step 2: Connect to SSE stream
    sse_url = f'http://localhost:8080/api/events/{uti}'
    messages = sseclient.SSEClient(sse_url)

    for msg in messages:
        if msg.data:
            event_data = json.loads(msg.data)
            status = event_data.get('status_code')

            if status == 'connected':
                print('Connected to payment stream')

            elif status == '206':
                print('Payment processing on terminal...')

            elif status == '200A':
                # Payment approved
                return {
                    'success': True,
                    'uti': uti,
                    'card_bin': event_data.get('bank_id_no'),
                    'card_last4': event_data.get('card_no_4digit'),
                    'auth_code': event_data.get('auth_code')
                }

            elif status == '200N':
                # Payment declined
                return {
                    'success': False,
                    'uti': uti,
                    'error': 'Payment declined'
                }

            elif status == '000':
                # Connection will close
                break

    return {
        'success': False,
        'error': 'Connection closed unexpectedly'
    }

# Usage
result = process_payment(2500, 'ORDER-789')  # $25.00
if result['success']:
    print(f"Payment approved! Auth: {result['auth_code']}")
else:
    print(f"Payment failed: {result['error']}")
```

### JavaScript Example (Odoo Frontend)

```javascript
class PaymentGateway {
  constructor(baseUrl) {
    this.baseUrl = baseUrl || 'http://localhost:8080';
    this.eventSource = null;
  }

  async processPayment(amountCents, reference) {
    return new Promise(async (resolve, reject) => {
      try {
        // Initiate transaction
        const response = await fetch(`${this.baseUrl}/api/sse/txn/sale`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            termid: '',
            amttxn: amountCents,
            ref: reference
          })
        });

        if (!response.ok) {
          throw new Error('Failed to initiate transaction');
        }

        const { uti } = await response.json();

        // Connect to SSE
        this.eventSource = new EventSource(`${this.baseUrl}/api/events/${uti}`);

        this.eventSource.onmessage = (event) => {
          const data = JSON.parse(event.data);

          switch(data.status_code) {
            case 'connected':
              console.log('Payment stream connected');
              break;

            case '206':
              // Notify UI: processing
              this.onStatusUpdate && this.onStatusUpdate('processing');
              break;

            case '200A':
              // Payment approved
              this.eventSource.close();
              resolve({
                success: true,
                uti: data.uti,
                cardBin: data.bank_id_no,
                cardLast4: data.card_no_4digit,
                authCode: data.auth_code
              });
              break;

            case '200N':
              // Payment declined
              this.eventSource.close();
              resolve({
                success: false,
                uti: data.uti,
                error: 'Payment declined'
              });
              break;

            case '000':
              // Reset - connection will close
              this.eventSource.close();
              break;
          }
        };

        this.eventSource.onerror = (error) => {
          console.error('SSE Error:', error);
          this.eventSource.close();
          reject(new Error('Connection error'));
        };

      } catch (error) {
        reject(error);
      }
    });
  }

  async cancelPayment() {
    try {
      await fetch(`${this.baseUrl}/api/txn/cancel`, {
        method: 'POST'
      });

      if (this.eventSource) {
        this.eventSource.close();
      }
    } catch (error) {
      console.error('Failed to cancel:', error);
    }
  }
}

// Usage
const gateway = new PaymentGateway('http://localhost:8080');

gateway.onStatusUpdate = (status) => {
  // Update UI based on status
  console.log('Payment status:', status);
};

try {
  const result = await gateway.processPayment(1500, 'ORDER-456'); // $15.00

  if (result.success) {
    console.log('Payment approved!');
    console.log('Auth code:', result.authCode);
    console.log('Card:', `${result.cardBin}******${result.cardLast4}`);
  } else {
    console.log('Payment failed:', result.error);
  }
} catch (error) {
  console.error('Payment error:', error);
}
```

---

## Security Considerations

1. **PCI Compliance**: Card numbers are split (first 6 + last 4 digits only) to minimize PCI scope
2. **Encryption**: Transaction data is encrypted in the database using AES-GCM
3. **CORS**: Enforce strict origin validation in production
4. **SSL/TLS**: Enable SSL for production deployments
5. **Network Security**: golocallink should only be accessible from trusted Odoo servers

---

## Support & Troubleshooting

### Common Issues

**SSE Connection Fails**
- Verify CORS configuration in `config.yaml`
- Check firewall rules allow connections to port 8080
- Ensure golocallink service is running

**Transaction Timeout**
- Verify PAX terminal is powered on and connected to network
- Check terminal IP address and port in configuration
- Verify bearer token is correct

**No Status Updates**
- Check SSE connection is established (look for "connected" message)
- Verify UTI from initiation response matches SSE endpoint parameter
- Check browser console for JavaScript errors

### Logs

golocallink uses structured logging (zap). Check logs for:
- Transaction initiation events
- PAX terminal communication errors
- Database errors
- SSE connection/disconnection events

---

**Document Version:** 1.0.0
**golocallink Version:** Compatible with v1.x
