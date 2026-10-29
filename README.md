# SmartPantry Pro

[![React](https://img.shields.io/badge/React-19.0-61DAFB?logo=react&logoColor=black)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Vite](https://img.shields.io/badge/Vite-8.x-646CFF?logo=vite&logoColor=white)](https://vitejs.dev/)
[![Express](https://img.shields.io/badge/Express-4.21-000000?logo=express&logoColor=white)](https://expressjs.com/)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-4.x-38B2AC?logo=tailwind-css&logoColor=white)](https://tailwindcss.com/)
[![Built with Google AI Studio](https://img.shields.io/badge/Built%20with-Google%20AI%20Studio-4285F4?logo=google&logoColor=white)](https://aistudio.google.com/)

**SmartPantry Pro** is an enterprise-grade automated pantry management, room turnaround, and corporate hospitality operations system built for **White Collar Realty (WCR)**. The application replaces manual checklists and ad-hoc communication with real-time operational workflows, automated daily IST routine scheduling, role-based interfaces, live camera photo evidence verification, and instant pantry order dispatching.

Developed using **Google AI Studio**, SmartPantry Pro delivers high-reliability operations for corporate facilities teams, executives, and pantry staff.

---

## Table of Contents

- [Overview & Architecture](#overview--architecture)
- [Key Features](#key-features)
- [Role-Based Dashboards](#role-based-dashboards)
- [Operational Workflows](#operational-workflows)
  - [Automated IST Daily Task Schedule](#automated-ist-daily-task-schedule)
  - [Meeting Room Lifecycle & Turnover](#meeting-room-lifecycle--turnover)
  - [Pantry Request & Hospitality Dispatch](#pantry-request--hospitality-dispatch)
  - [Live Camera Photo Evidence Pipeline](#live-camera-photo-evidence-pipeline)
  - [Attendance & Shift Tracking](#attendance--shift-tracking)
- [Tech Stack](#tech-stack)
- [Screenshots & UI Previews](#screenshots--ui-previews)
- [Getting Started](#getting-started)
  - [Prerequisites](#prerequisites)
  - [Installation](#installation)
  - [Environment Variables](#environment-variables)
  - [Running the Application](#running-the-application)
- [Scripts & Verification](#scripts--verification)
- [Security & Defensive Architecture](#security--defensive-architecture)
- [Current Limitations & Roadmap](#current-limitations--roadmap)
- [Author & Repository](#author--repository)

---

## Overview & Architecture

Corporate hospitality and facility cleanliness directly impact client impressions and employee productivity. SmartPantry Pro bridges the operational gap between management, administration, and ground pantry personnel:

```
┌─────────────────────────────────────────────────────────────────┐
│                       Frontend (React 19)                       │
│  ┌────────────────────────┐         ┌────────────────────────┐  │
│  │   Pantry Staff View    │         │    Management View     │  │
│  │  - Live Checklist      │         │  - Real-Time Rooms     │  │
│  │  - Camera Capture      │         │  - Visitor Management  │  │
│  │  - Shift Attendance    │         │  - Analytics & Reports │  │
│  │  - Order Fulfillment   │         │  - User & Role Admin   │  │
│  └───────────▲────────────┘         └───────────▲────────────┘  │
│              │                                  │               │
│              └───────────────┬──────────────────┘               │
│                              │ HTTP REST + SSE (/api/realtime)   │
└──────────────────────────────┼──────────────────────────────────┘
                               │
┌──────────────────────────────▼──────────────────────────────────┐
│                    Backend Server (Express)                     │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  - Sliding-Window Rate Limiter (Auth & API Buckets)       │  │
│  │  - Session Bearer Authentication & RBAC Middleware        │  │
│  │  - Authoritative IST (Asia/Kolkata) Task Scheduling Engine │  │
│  │  - Server-Sent Events (SSE) Event Broadcaster             │  │
│  │  - Image Validation & Secure Static File Server           │  │
│  └───────────────────────────┬───────────────────────────────┘  │
│                              │                                  │
│  ┌───────────────────────────┴───────────────────────────────┐  │
│  │                     Persistence Layer                     │  │
│  │  - JSON Flat-File Database: /data/smart_pantry_db.json     │  │
│  │  - Photo Uploads Storage:   /uploads/photos/              │  │
│  └───────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

- **Full-Stack Monolith**: Single Node.js server (`server.ts`) hosting API endpoints, real-time SSE streams, static photo serving, and Vite middlewares in development.
- **Authoritative Server Time**: Synchronization mechanism offsets client clocks to ensure strict IST (UTC+05:30) task deadlines and prevents device clock tampering.
- **Resilient Real-Time Broadcaster**: Server-Sent Events (SSE) automatically stream task assignments, status transitions, pantry requests, and room state updates to connected clients.

---

## Key Features

- **Automated Task Generation**: Generates daily recurring tasks with time-window constraints based on active room configurations and staff rosters.
- **Proactive Schedule Alerts**: Dispatches a 5-minute pre-warning (`WARNING_5MIN`) followed by a due-now reminder (`TASK_DUE_NOW`) directly to the assigned staff's active session.
- **Strict Camera Photo Verification**: Requires photographic proof before high-priority room tasks can be completed, preventing unverified claims.
- **15 Configured Corporate Areas**: Pre-configured with exact furniture setup specifications (e.g., Community Room: 1 large table + 10 chairs; Meeting Suites: 1 table + 4 chairs).
- **Visitor Protocol & Room Reset**: Automatically creates preparation checklists prior to scheduled client arrivals and triggers reset tasks upon visitor departure.
- **VIP & Executive Hospitality**: In-app on-demand pantry orders with urgent priority routing for boardrooms and executive suites.
- **Comprehensive Audit Trail**: Every status transition, photo upload, user edit, and milestone trigger is permanently logged with timestamps and actor emails.
- **Glassmorphism & 3D Interactive UI**: Modern corporate aesthetics built with Tailwind CSS, custom depth styles, and pointer-following 3D perspective tilts powered by Motion.

---

## Role-Based Dashboards

The application implements granular Role-Based Access Control (RBAC) across four primary roles:

| Role | Dashboard | Primary Responsibilities |
| :--- | :--- | :--- |
| **Pantry Boy** (`PANTRY_BOY`) | Operational Pantry View | • View assigned daily routines & urgent tasks<br>• Complete step-by-step checklists<br>• Capture mandatory live camera photo evidence<br>• Fulfill incoming beverage and snack orders<br>• Clock shift attendance |
| **HR** (`HR`) | Management Console | • Coordinate guest visits & room reservations<br>• Oversee facilities readiness and staff attendance<br>• Monitor task completion rates & delayed areas<br>• Submit VIP refreshment requests |
| **Co-Founder** | Executive Management | • Real-time overview of meeting suite availability<br>• Priority dispatch for executive cabins & VIP delegations<br>• Direct visibility into facility upkeep and service logs |
| **Administrator** (`ADMIN`) | Full Management Console | • Configure rooms, furniture setups, and checklists<br>• Manage employee accounts, access permissions, and deactivations<br>• Trigger manual IST schedule milestones<br>• Review immutable audit logs & export analytical reports |

---

## Operational Workflows

### Automated IST Daily Task Schedule

Every morning, the scheduler instantiates routine tasks mapped to authoritative Indian Standard Time (IST) milestones:

```
 09:00 AM ─── Employee Desk Cleaning & Workstation Setup (First Priority)
 09:15 AM ─── Reception Front-Desk Setup & Sanitization
 09:30 AM ─── Priority 1 Meeting Suites (Prestige Loft, The Skyline, etc. - Complete by 11:00 AM)
 10:00 AM ─── Morning Desk-to-Desk Water Bottle Distribution
 11:00 AM ─── Priority 2 Executive Cabins (CEO Room, CO-FOUNDER - Complete by 12:00 PM)
 12:00 PM ─── Indoor Office Plant Watering
 12:20 PM ─── Corridors & Outer Area Cleaning
 02:00 PM ─── Office & Pantry Dustbin Clearance & Relining
 04:00 PM ─── Afternoon Water Bottle Refill & Redistribution
 07:30 PM ─── Mandatory End-of-Day Closing Inspection (Unfinished tasks marked OVERDUE)
```

### Meeting Room Lifecycle & Turnover

Meeting suites follow a verified state machine ensuring rooms are sanitized and prepared before clients arrive:

```
[ AVAILABLE ] ──(Assign / Book)──> [ RESERVED / ASSIGNED ]
                                            │
                                  (Auto-generate VISITOR_PREP)
                                            │
                                            ▼
[ OCCUPIED ] <──(Visitor Arrives)── [ READY_FOR_VISITOR ]
      │
(Visitor Departs)
      │
      ▼
[ CLEANING_REQUIRED ] ──(Auto-generate VISITOR_RESET)──> [ CLEANING_IN_PROGRESS ]
                                                                  │
                                                        (Photo Verification)
                                                                  │
                                                                  ▼
                                                            [ AVAILABLE ]
```

### Pantry Request & Hospitality Dispatch

1. **Request Creation**: Authorized staff create requests specifying room, items (e.g., *Black Coffee*, *Tender Coconut Water*, *Dry Fruit Platter*), priority (`URGENT`, `HIGH`, `NORMAL`), and special instructions.
2. **Real-Time Notification**: An audible notification and instant toast alert are pushed to active pantry staff via SSE.
3. **Fulfillment Cycle**: The request transitions from `PENDING` $\rightarrow$ `IN_PREPARATION` $\rightarrow$ `SERVED`, recording the server timestamp and server actor.

### Live Camera Photo Evidence Pipeline

To guarantee authenticity and avoid fraudulent uploads:
- **Direct Camera Access**: Uses `navigator.mediaDevices.getUserMedia` with video constraints to capture genuine frames from device webcams or mobile cameras.
- **Client & Server Validation**:
  - Magic byte inspection verifies genuine image binary headers (`image/jpeg`, `image/png`, `image/webp`).
  - Size enforcement: Minimum 20 bytes (rejecting blank canvas dumps), maximum 10 MB per frame, 45 MB total batch limit.
  - Multi-photo capture sessions linking up to 10 photos per task.
- **Protected Static File Serving**: Photos stored in `/uploads/photos` require active session tokens and RBAC read permissions. Direct unauthenticated access is rejected with HTTP 401.

### Attendance & Shift Tracking

- Attendance records are automatically registered upon corporate login.
- Tracks `loginTime`, `loginTimeIST`, `logoutTime`, and total shift duration in minutes.
- HR and Administrators can review daily staff presence in the Management console.

---

## Tech Stack

### Frontend
- **Framework**: React 19 (`react`, `react-dom`)
- **Language**: TypeScript (`strict: true`)
- **Build Tool**: Vite 8 with `@vitejs/plugin-react`
- **Styling**: Tailwind CSS v4 (`@tailwindcss/vite`)
- **Animations & Gestures**: Motion (`motion/react` v12)
- **Icons**: Lucide React (`lucide-react`)

### Backend & Middleware
- **Runtime**: Node.js 22 (LTS)
- **Server Framework**: Express 4 (`express`)
- **Execution**: `tsx` (TypeScript Execute)
- **Real-Time Layer**: Server-Sent Events (SSE)
- **Configuration & Security**: `dotenv`, custom sliding-window rate limiters, strict HTTP headers

### Persistence & Storage
- **Database**: Atomic JSON flat-file storage (`/data/smart_pantry_db.json`)
- **Binary Assets**: Server disk photo storage (`/uploads/photos`) with authorized streaming

## Getting Started

### Prerequisites

- **Node.js**: v20.x or v22.x (Recommended: Node.js 22)
- **Package Manager**: `npm` (v10+)
- **Browser**: Modern Chromium, Firefox, or Safari browser with webcam permissions enabled.

### Installation

1. **Clone the repository**:
   ```bash
   git clone https://github.com/chetandixit2407/Pantry.git
   cd Pantry
   ```

2. **Install dependencies**:
   ```bash
   npm install
   ```

3. **Configure environment variables**:
   ```bash
   cp .env.example .env
   ```

### Environment Variables

The project uses `.env` for configurable runtime variables. See `.env.example`:

| Variable | Description | Default / Example |
| :--- | :--- | :--- |
| `DISABLE_HMR` | Disables Vite Hot Module Replacement in containerized/headless environments | `false` |
| `SESSION_SECRET` | Secret key used for session hashing | `wcr_super_secret_session_key` |
| `WCR_DATA_DIR` | Custom directory path for local JSON database storage | `./data` |
| `WCR_UPLOADS_DIR` | Custom directory path for uploaded verification photos | `./uploads/photos` |
| `WCR_RATE_LIMIT_AUTH_MAX` | Max allowed authentication attempts per minute per IP | `60` |
| `WCR_RATE_LIMIT_API_MAX` | Max allowed general API requests per minute per IP | `600` |

### Running the Application

#### Development Mode
Runs the unified full-stack server with Vite middleware on port 3000:
```bash
npm run dev
```
Open [http://localhost:3000](http://localhost:3000) in your browser.

#### Production Build & Start
1. Build client static assets:
   ```bash
   npm run build
   ```
2. Start the production server:
   ```bash
   npm start
   ```

---

## Scripts & Verification

The project includes built-in scripts and verification test suites:

| Command | Purpose |
| :--- | :--- |
| `npm run dev` | Starts the full-stack application using `tsx server.ts` |
| `npm run build` | Compiles frontend assets into `dist/` |
| `npm run start` | Runs the compiled application in production mode |
| `npm run lint` | Performs strict TypeScript static type analysis (`tsc --noEmit`) |
| `npm run clean` | Cleans build artifacts (`dist` and generated outputs) |

### Automated Verification Suites
Run the verification suites using `npx tsx`:
```bash
# Verify end-to-end multi-photo capture and evidence integrity
npx tsx verify_multi_photo_workflow_suite.ts

# Verify room assignment state transitions and visitor turnaround
npx tsx verify_room_assignment_suite.ts

# Run the complete production readiness audit
npx tsx comprehensive_production_verification.ts
```

---

## Security & Defensive Architecture

- **Protected Photo Storage**: Photos stored in `/uploads/photos/` cannot be accessed by unauthenticated visitors. The backend checks caller session tokens and rejects unauthorized requests.
- **Strict File Inspection**: Prevents arbitrary file uploads by validating binary magic bytes before writing photos to disk.
- **Sliding-Window Rate Limiting**: Dedicated rate-limit buckets protect against brute-force login attempts and API request flooding.
- **Text Sanitization & Deduplication**: Built-in normalizer (`src/utils/textNormalizer.ts`) prevents accidental duplicated labels, malformed input tags, or XSS vectors in user notes and task titles.
- **Session Revocation Enforcement**: Deactivating a staff member immediately terminates their SSE connection and revokes active API privileges in real time.

---

## Current Limitations & Roadmap

### Current Limitations
- **Storage Layer**: Uses file-based JSON persistence (`/data/smart_pantry_db.json`), ideal for single-instance deployments but not suited for multi-region clustering.
- **In-Process Pub/Sub**: SSE event broadcasting runs in-memory on the active Node.js process.

### Planned Enhancements
- [ ] **Relational Database Migration**: Transition from JSON file persistence to Cloud SQL (PostgreSQL) using Drizzle ORM.
- [ ] **Web Push Notifications**: Integrate the Web Push API for lock-screen task alerts on staff mobile devices.
- [ ] **Barcode / QR Room Scans**: Require scanning a physical QR code placed in each meeting room before unlocking the camera capture modal.
- [ ] **Pantry Inventory Intelligence**: Predictive replenishment tracking using Gemini API multimodal analysis on pantry shelf photos.

---

## Author & Repository

- **Author**: [Chetan Dixit](https://github.com/chetandixit2407)
- **Repository**: [https://github.com/chetandixit2407/Pantry](https://github.com/chetandixit2407/Pantry)
- **Platform**: Developed with [Google AI Studio](https://aistudio.google.com/)

---

*SmartPantry Pro — Elevating corporate hospitality and workspace excellence through intelligent operational automation.*
