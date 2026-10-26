"""
=============================================================================
STANDALONE NEWS AUTO-SCHEDULER (PYTHON)
=============================================================================
Runs daily_runner.py automatically on a recurring schedule without requiring
any external tools or n8n.
"""

import time
import os
import sys
from datetime import datetime

# UTF-8 fix for Windows console
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')
if hasattr(sys.stderr, 'reconfigure'):
    sys.stderr.reconfigure(encoding='utf-8')

from daily_runner import run_daily_pipeline

INTERVAL_MINUTES = int(os.getenv("AUTO_SYNC_INTERVAL_MINUTES", "60"))

def run_loop():
    print("=====================================================================")
    print(f"[*] DAILY BIZ & GOV - AUTOMATED NEWS SCHEDULER STARTED")
    print(f"[*] Interval: Every {INTERVAL_MINUTES} minutes")
    print("=====================================================================")

    while True:
        start_time = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        print(f"\n[🔄] Triggering automated scraper & AI pipeline at {start_time}...")
        try:
            success = run_daily_pipeline()
            if success:
                print(f"[✅] Automated run completed successfully at {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
            else:
                print(f"[⚠️] Pipeline finished with notices.")
        except Exception as e:
            print(f"[❌] Scheduler run error: {e}")

        print(f"[*] Next run in {INTERVAL_MINUTES} minutes ({INTERVAL_MINUTES * 60}s). Waiting...")
        time.sleep(INTERVAL_MINUTES * 60)

if __name__ == "__main__":
    run_loop()
