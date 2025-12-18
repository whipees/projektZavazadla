# ✈️ Airport Baggage Handling System


## 📋 Přehled architektury

Systém je rozdělen na dvě nezávislé aplikace, které spolu komunikují v reálném čase.

### 1. Alpha Server (Check-in & Logic Provider)
* **Role:** Zdroj pravdy (Source of Truth), REST API, Business logika.
* **Technologie:** Node.js, Express, Axios.
* **Zodpovědnost:**
    * Odbavení zavazadel (Check-in).
    * Validace hmotnostních limitů letadel (Business Logic).
    * Notifikace externích systémů pomocí **Webhooků**.
    * Robustní odesílání dat s mechanismem **Opakovaného doručení (Retry pattern)**.

### 2. Beta Server (Display & Notification Hub)
* **Role:** Agregátor událostí, Real-time notifikace klientů.
* **Technologie:** Node.js, Express, WebSocket (`ws`).
* **Zodpovědnost:**
    * Příjem Webhooků od Alphy (`/webhook-receiver`).
    * Transformace dat pro koncové klienty (přiřazování pásů pro výdej).
    * **WebSocket server** pro okamžitou aktualizaci informačních tabulí (Frontend).

---

## 🛠 Popis netriviálních mechanik a Business Logic

Projekt splňuje požadavky na pokročilou logiku a přidanou hodnotu nad daty následujícími způsoby:

### A. Retry Pattern (Netriviální mechanika)
Komunikace mezi servery není vždy spolehlivá. Alpha server implementuje **rekurzivní retry mechanismus** při odesílání webhooku.
- Pokud je Beta server nedostupný, Alpha se nevzdává okamžitě.
- Pokusí se o doručení znovu (maximálně 3x) s časovým odstupem (backoff 2000ms).
- **Kde to najdete:** Funkce `sendWebhookWithRetry` v `alpha-server.js`.

### B. Validace přetížení letadla (Business Logic)
Systém není pouhým úložištěm dat. Při každém požadavku na odbavení (`POST /bag`) se dynamicky vypočítává aktuální zátěž konkrétního letu.
- Pokud by nový kufr způsobil překročení limitu (např. 100 kg pro let OK123), systém požadavek zamítne (`409 Conflict`).
- **Kde to najdete:** Endpoint `/bag` a objekt `FLIGHT_LIMITS`.

### C. Inteligentní routing zavazadel (Data Enrichment)
Beta server pouze nepřeposílá data, ale obohacuje je. Při události `bag_arrived` analyzuje číslo letu:
- Lety začínající na `OK` -> Pás č. 1.
- Ostatní lety -> Pás č. 2.
- Tato logika se děje na backendu Bety a frontend dostává již hotovou informaci.

---

```mermaid
graph TD
    %% --- STYLOVÁNÍ ---
    classDef alpha fill:#e3f2fd,stroke:#1565c0,stroke-width:2px;
    classDef alphaFunc fill:#bbdefb,stroke:#0d47a1,stroke-dasharray: 5 5;
    classDef beta fill:#fff3e0,stroke:#e65100,stroke-width:2px;
    classDef betaFunc fill:#ffe0b2,stroke:#bf360c,stroke-dasharray: 5 5;
    classDef client fill:#f3e5f5,stroke:#4a148c,stroke-width:2px;
    classDef db fill:#eee,stroke:#333,stroke-width:1px;

    %% --- ACTORS ---
    User((👤 Obsluha)):::client
    Browser((🖥️ Prohlížeč)):::client

    %% --- ALPHA SERVER ---
    subgraph Alpha_Zone [🅰️ Alpha Server :3000]
        direction TB
        
        %% Endpointy
        A_POST_Bag[POST /bag]:::alpha
        A_PATCH_Status[PATCH /bag/:id/status]:::alpha
        
        %% Funkce a Logika
        A_Func_GetWeight[[ƒ getFlightWeight]]:::alphaFunc
        A_Check_Limit{Limit > Max?}:::alphaFunc
        A_DB[("bags = []")]:::db
        
        A_Update_Status[Update bag.status]:::alphaFunc
        A_Func_Webhook[[ƒ sendWebhookWithRetry]]:::alphaFunc
        A_Retry_Logic{Catch Error?}:::alphaFunc
        A_Timeout[setTimeout 2000ms]:::alphaFunc
    end

    %% --- BETA SERVER ---
    subgraph Beta_Zone [🅱️ Beta Server :8080]
        direction TB
        
        %% Endpointy
        B_POST_Webhook[POST /webhook-receiver]:::beta
        
        %% Logika
        B_Decide_Event{req.body.event?}:::betaFunc
        B_Logic_Belt["Const assignedBelt<br/>(OK* ? 1 : 2)"]:::betaFunc
        B_Make_Msg_1[Msg: PLANE_LOADED]:::betaFunc
        B_Make_Msg_2[Msg: BELT_ARRIVAL]:::betaFunc
        
        %% WebSocket
        B_Func_Broadcast[[ƒ broadcast]]:::betaFunc
        B_WSS((WebSocket Server)):::beta
    end

    %% --- TOK DAT (TRAFFIC) ---

    %% 1. CHECK-IN PROCESS
    User -->|"{ owner, flight, weight }"| A_POST_Bag
    A_POST_Bag --> A_Func_GetWeight
    A_Func_GetWeight -->|Vypočte součet| A_Check_Limit
    A_Check_Limit -- ANO (Přetíženo) --> A_409[RES 409 Conflict]:::alpha
    A_Check_Limit -- NE (OK) --> A_DB
    A_DB -.->|Push newBag| A_201[RES 201 Created]:::alpha

    %% 2. STATUS CHANGE PROCESS
    User -->|"{ status: 'LOADED' }"| A_PATCH_Status
    A_PATCH_Status --> A_Update_Status
    A_Update_Status --> A_DB
    A_Update_Status -->|Call async| A_Func_Webhook
    
    %% 3. WEBHOOK & RETRY
    A_Func_Webhook -->|Axios POST| B_POST_Webhook
    A_Func_Webhook -- Error/Fail --> A_Retry_Logic
    A_Retry_Logic -- "pokus <= 3" --> A_Timeout
    A_Timeout -->|Rekurzivní volání| A_Func_Webhook
    
    %% 4. BETA PROCESSING
    B_POST_Webhook -->|"{ event, data }"| B_Decide_Event
    
    B_Decide_Event -- 'bag_loaded' --> B_Make_Msg_1
    B_Decide_Event -- 'bag_arrived' --> B_Logic_Belt
    B_Logic_Belt -->|Přidá belt ID| B_Make_Msg_2
    
    B_Make_Msg_1 --> B_Func_Broadcast
    B_Make_Msg_2 --> B_Func_Broadcast

    %% 5. WEBSOCKET BROADCAST
    B_Func_Broadcast -->|Iterace clients| B_WSS
    B_WSS ==>|"JSON { type, bag... }"| Browser
```


## 📡 API Dokumentace

### Alpha Server (Port 3000)

#### `POST /bag` - Odbavení kufru
Vytvoří nový kufr, pokud to kapacita letu dovolí.
```json
// Request
{
  "owner": "Jan Novak",
  "flight": "OK123",
  "weight": 20
}