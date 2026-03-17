# MPGV Monitor – Full Stress Test Plan (Pluto-CSHIS-9001)

**Author:** Faheem  
**Goal:** Test how many concurrent users the deployed MPGV Monitor can handle on `pluto.cs.hi.is:9001` – including real-time map usage, timeline slider, toggles, and API calls.

---

## 1. Objectives

1. Measure how the live server responds to:
   - 20–40+ simultaneous users
   - Continuous interaction (zooming, dragging, toggling layers)
   - Backend load on `/earthquakes`, `/update-earthquakes`, `/reconcile`

2. Collect:
   - Response time (ms)
   - Throughput (requests/sec)
   - Error rate (failed requests)
   - CPU and RAM usage on Pluto
   - Maximum number of “comfortable” simultaneous users

3. Identify bottlenecks:
   - Flask + Gunicorn performance
   - SQLite locks and slow queries
   - Effect of scraping and reconcile jobs
   - Frontend load (Google Maps rendering on clients)

---

## 2. Test Environment

**Server**

- Domain: `pluto.cs.hi.is`
- Port: `9001`
- URL: `http://pluto.cs.hi.is:9001/`

**Frontend load triggers**

- Moving the time window slider
- Zooming into days/months/years
- Toggling:
  - “Show Volcanoes”
  - “Deep Earthquakes”
  - “Grid” / “Color by time” (if enabled)
- Changing map type (Map / Satellite / Dark mode / Terrain)
- Dragging and zooming the map over Iceland
- Opening About page and returning to main map

**Backend load triggers**

- `GET /earthquakes`
- `POST /update-earthquakes`
- `POST /reconcile`
- `GET /volcanoes` (or related volcano endpoints)

---

## 3. Volunteer Instructions (Human Stress Test)

These are the steps each student/volunteer should follow during the live test.

### Step 1 — Open the site

Open in a browser:

> `http://pluto.cs.hi.is:9001/`

### Step 2 — Timebox

Set a timer for **3–5 minutes**.  
During this period, keep interacting with the site without long pauses.

### Step 3 — Interaction script (repeat continuously)

Each volunteer should:

- Zoom **in/out** on the map repeatedly
- Drag the map around Iceland
- Move the **time window slider** (scroll, drag, zoom in/out on time)
- Toggle:
  - “Show Volcanoes” ON/OFF every ~5 seconds
  - “Deep Earthquakes” ON/OFF every ~5 seconds
- Change **map type** (Map ↔ Satellite ↔ Dark Mode)
- Switch between months/years on the slider
- Click the **About** page and go back to the map
- Refresh the page a few times during the 3–5 minutes

### Step 4 — Optional “power users”

Ask 5–10 volunteers to act as “power users”:

- Open **DevTools → Network → Disable cache**
- Open **2–3 tabs** of the site
- Refresh each tab every 1–2 seconds for a short period
- Continue zooming and dragging in at least one tab

### Step 5 — Fill the feedback form

After the timebox is done, each volunteer fills your Google Form with:

- Did the map lag or freeze? (Yes/No)
- Did markers fail to load? (Yes/No)
- Did map tiles disappear? (Yes/No)
- Approximate device (Laptop / Desktop / Mobile)
- Connection type (Wi-Fi / Mobile data / Eduroam / etc.)
- Any errors or weird behaviour noticed

---

## 4. Backend Load Test (Instructor / Dev Only)

These you run from **your own machine**, not students.

### 4.1 ApacheBench (ab)

To do:

```bash
# Moderate load
ab -n 200 -c 20 http://pluto.cs.hi.is:9001/earthquakes

# Higher concurrency
ab -n 1000 -c 100 http://pluto.cs.hi.is:9001/earthquakes

# Spike on the main page
ab -n 500 -c 100 http://pluto.cs.hi.is:9001/