import requests
from bs4 import BeautifulSoup
from datetime import datetime
import re
import os
import sqlite3
from sqlalchemy.exc import IntegrityError

CURRENT_FILE_PATH = os.path.dirname(os.path.abspath(__file__))
DB_DIR = os.path.join(CURRENT_FILE_PATH, "data")
os.makedirs(DB_DIR, exist_ok=True)
DB_PATH = os.path.join(DB_DIR, "earthquakes.db")

try:
    from app import app, db, Earthquake
    USING_FLASK = True
except (ImportError, ModuleNotFoundError):
    USING_FLASK = False
    print("Running in standalone mode without Flask app context.")

BASE_URL = 'http://hraun.vedur.is/ja/Mpgv/'

def get_monthly_data(year, month):
    """Scrapes data for a specific month and filters by magnitude >= 3.0."""
    url = f"{BASE_URL}{year}/{year}-{str(month).zfill(2)}.html"
    response = requests.get(url, timeout=20)
    soup = BeautifulSoup(response.content, 'html.parser')
    table = soup.find('table', class_='dataframe')

    if not table:
        return []

    data = []
    for row in table.find('tbody').find_all('tr'):
        cols = row.find_all('td')
        if len(cols) >= 8:
            date_time_str = cols[0].text.strip()
            try:
                date_time_obj = datetime.strptime(date_time_str, '%Y-%m-%d %H:%M:%S.%f')
            except ValueError:
                date_time_obj = datetime.strptime(date_time_str, '%Y-%m-%d %H:%M:%S')

            date_time_str_cleaned = date_time_obj.strftime('%Y-%m-%d %H:%M:%S')

            latitude = cols[1].text.strip()
            longitude = cols[2].text.strip()
            depth = cols[3].text.strip()
            mw_mean = cols[6].text.strip()

            if not latitude or not longitude or not depth or not mw_mean:
                continue

            try:
                mw_mean = float(mw_mean)
                if mw_mean < 3.0:
                    continue
            except ValueError:
                continue

            data.append({
                "date_time": date_time_str_cleaned,
                "latitude": float(latitude),
                "longitude": float(longitude),
                "depth": float(depth),
                "mw_mean": mw_mean
            })

    return data

def scrape_all_earthquake_data():
    """Scrape MPGV and insert new records (M ≥ 3.0) into the database."""
    if USING_FLASK:
        from app import app, db, Earthquake
        with app.app_context():
            _scrape_and_save_with_flask()
    else:
        _scrape_and_save_with_sqlite()

def _scrape_and_save_with_flask():
    """Scrape all available years/months from MPGV and upsert via SQLAlchemy."""
    from app import db, Earthquake

    response = requests.get(BASE_URL, timeout=20)
    soup = BeautifulSoup(response.content, 'html.parser')
    year_links = sorted([a['href'].strip('/') for a in soup.find_all('a', href=re.compile(r'^\d{4}/$'))], reverse=True)

    new_entries = 0

    for year in year_links:
        year_url = f"{BASE_URL}{year}/"
        year_response = requests.get(year_url, timeout=20)
        year_soup = BeautifulSoup(year_response.content, 'html.parser')
        month_links = sorted([a['href'].strip('.html') for a in year_soup.find_all('a', href=re.compile(r'^\d{4}-\d{2}\.html$'))], reverse=True)

        for month in month_links:
            _yr, month_num = month.split('-')
            monthly_data = get_monthly_data(year, month_num)

            for quake in monthly_data:
                try:
                    db.session.add(Earthquake(**quake))
                    db.session.commit()
                    new_entries += 1
                except IntegrityError:
                    db.session.rollback()
                    continue

    print(f"{new_entries} new earthquake records added (Flask).")

def _scrape_and_save_with_sqlite():
    """Standalone fallback: scrape most recent year + 2 months directly via sqlite3 (no Flask)."""
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute('''
    CREATE TABLE IF NOT EXISTS earthquake (
        id INTEGER PRIMARY KEY,
        date_time TEXT NOT NULL,
        latitude REAL NOT NULL,
        longitude REAL NOT NULL,
        depth REAL NOT NULL,
        mw_mean REAL NOT NULL,
        UNIQUE(date_time, latitude, longitude)
    )
    ''')
    
    response = requests.get(BASE_URL, timeout=20)
    soup = BeautifulSoup(response.content, 'html.parser')
    year_links = sorted([a['href'].strip('/') for a in soup.find_all('a', href=re.compile(r'^\d{4}/$'))], reverse=True)

    new_entries = 0

    for year in year_links[:1]:  # most recent year only
        year_url = f"{BASE_URL}{year}/"
        year_response = requests.get(year_url, timeout=20)
        year_soup = BeautifulSoup(year_response.content, 'html.parser')
        month_links = sorted([a['href'].strip('.html') for a in year_soup.find_all('a', href=re.compile(r'^\d{4}-\d{2}\.html$'))], reverse=True)

        for month in month_links[:2]:  # most recent 2 months only
            _yr, month_num = month.split('-')
            monthly_data = get_monthly_data(year, month_num)

            for quake in monthly_data:
                try:
                    cursor.execute('''
                    INSERT OR IGNORE INTO earthquake (date_time, latitude, longitude, depth, mw_mean)
                    VALUES (?, ?, ?, ?, ?)
                    ''', (
                        quake['date_time'],
                        quake['latitude'],
                        quake['longitude'],
                        quake['depth'],
                        quake['mw_mean']
                    ))
                    if cursor.rowcount > 0:
                        new_entries += 1
                except sqlite3.Error as e:
                    print(f":( SQLite error: {e}")
                    continue

    conn.commit()
    conn.close()
    print(f"{new_entries} new earthquake records added (direct SQLite).")

if __name__ == "__main__":
    scrape_all_earthquake_data()
