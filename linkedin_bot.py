"""
=============================================================================
LINKEDIN AUTOMATION BOT (PERSONAL PROFILE) VIA PLAYWRIGHT
=============================================================================
Automates posting news directly to a personal LinkedIn profile without requiring
a LinkedIn Developer App or Company Page.
"""

import sys
import os
import json
import time
import argparse
from pathlib import Path
from dotenv import load_dotenv

# Reconfigure stdout for UTF-8
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')
if hasattr(sys.stderr, 'reconfigure'):
    sys.stderr.reconfigure(encoding='utf-8')

PROJECT_DIR = Path(__file__).resolve().parent
load_dotenv(PROJECT_DIR / ".env")

SESSION_FILE = PROJECT_DIR / "linkedin_session.json"
DEFAULT_EMAIL = os.getenv("LINKEDIN_EMAIL", "altrixx99@gmail.com")

def format_linkedin_caption(article: dict) -> str:
    """Formats the headline, summary, tags and link into a high-engagement LinkedIn post."""
    headline = (article.get("headline") or article.get("raw_title") or "").strip()
    summary = (article.get("summary") or article.get("raw_summary") or "").strip()
    source_url = (article.get("sourceUrl") or article.get("url") or "").strip()
    tags = article.get("tags") or []
    
    if isinstance(tags, str):
        tags = [t.strip() for t in tags.split(",") if t.strip()]

    # Format tags as hashtags
    hashtags = []
    for tag in tags:
        clean_tag = "".join(ch for ch in tag if ch.isalnum())
        if clean_tag:
            hashtags.append(f"#{clean_tag}")
    
    # Default hashtags if none provided
    if not any("SriLanka" in h for h in hashtags):
        hashtags.append("#SriLanka")
    if not any("Business" in h for h in hashtags):
        hashtags.append("#BusinessNews")
    if not any("Economy" in h for h in hashtags):
        hashtags.append("#Economy")

    hashtag_line = " ".join(hashtags[:5])

    caption = f"🇱🇰 {headline}\n\n{summary}\n\n👉 Read Full Report: {source_url}\n\n{hashtag_line}"
    return caption.strip()


def run_login_flow(email: str = DEFAULT_EMAIL):
    """
    Opens a visible browser for 1-time login.
    User enters password and solves any OTP/captcha.
    Once feed is reached, session cookies are saved to linkedin_session.json.
    """
    from playwright.sync_api import sync_playwright

    print(f"[*] Starting LinkedIn 1-Time Session Setup for: {email}...")
    print("[*] A browser window will open. Please enter your LinkedIn password and complete sign-in.")

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=False)
        context = browser.new_context()
        page = context.new_page()

        page.goto("https://www.linkedin.com/login")
        
        # Pre-fill email if field exists
        try:
            page.fill("#username", email)
        except Exception:
            pass

        print("[*] Waiting for successful login (navigating to feed)...")
        # Wait up to 180 seconds for user to sign in
        try:
            page.wait_for_url("**/feed/**", timeout=180000)
            print("[+] Login detected! Saving session state...")
            context.storage_state(path=str(SESSION_FILE))
            print(f"[✅] Session successfully saved to {SESSION_FILE}!")
            result = {"success": True, "message": "Session saved successfully"}
        except Exception as e:
            print(f"[-] Login timed out or error: {e}")
            result = {"success": False, "error": str(e)}

        browser.close()
        return result


def check_session_status():
    """Checks if a valid saved session exists."""
    if not SESSION_FILE.exists():
        return {"connected": False, "message": "No session file found. Please log in first."}
    
    try:
        with open(SESSION_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
            cookies = data.get("cookies", [])
            has_li_at = any(c.get("name") == "li_at" for c in cookies)
            if has_li_at:
                return {"connected": True, "message": "LinkedIn session is active and ready."}
    except Exception as e:
        return {"connected": False, "message": f"Error reading session: {e}"}

    return {"connected": False, "message": "Session file exists but is missing auth cookies."}


def post_to_linkedin(article_data: dict, headless: bool = True):
    """Publishes a news post to the personal profile feed using Playwright."""
    from playwright.sync_api import sync_playwright

    status = check_session_status()
    if not status.get("connected"):
        return {"success": False, "error": "LinkedIn session not connected. Run --login first."}

    caption = format_linkedin_caption(article_data)
    print(f"[*] Prepared LinkedIn Caption:\n---\n{caption[:150]}...\n---")

    with sync_playwright() as p:
        # Launch browser with saved session
        browser = p.chromium.launch(headless=headless)
        context = browser.new_context(storage_state=str(SESSION_FILE))
        page = context.new_page()

        try:
            print("[*] Navigating to LinkedIn Feed...")
            page.goto("https://www.linkedin.com/feed/", timeout=45000)
            page.wait_for_load_state("domcontentloaded")

            # Check if we were redirected to login
            if "login" in page.url:
                browser.close()
                return {"success": False, "error": "Session expired. Please run --login to refresh."}

            print("[*] Locating 'Start a post' trigger...")
            time.sleep(2)

            # Click 'Start a post' button (matches multiple LinkedIn UI variations)
            start_post_clicked = False
            triggers = [
                "button:has-text('Start a post')",
                ".share-box-feed-entry__top-bar button",
                "button.share-box-feed-entry__trigger",
                "[aria-label*='Start a post']"
            ]
            for sel in triggers:
                try:
                    trigger = page.locator(sel).first
                    if trigger.is_visible(timeout=3000):
                        trigger.click()
                        start_post_clicked = True
                        break
                except Exception:
                    continue

            if not start_post_clicked:
                browser.close()
                return {"success": False, "error": "Could not find 'Start a post' button on LinkedIn feed"}

            print("[*] Typing post caption...")
            time.sleep(2)

            # Locate editor modal textbox
            editor_selectors = [
                "div.ql-editor[contenteditable='true']",
                "div[role='textbox'][contenteditable='true']",
                ".share-creation-state__text-editor div[contenteditable='true']",
                "div[data-placeholder*='What do you want to talk about?']"
            ]
            editor_found = False
            for sel in editor_selectors:
                try:
                    editor = page.locator(sel).first
                    if editor.is_visible(timeout=5000):
                        editor.click()
                        # Type text smoothly into the editor
                        editor.fill(caption)
                        editor_found = True
                        break
                except Exception:
                    continue

            if not editor_found:
                browser.close()
                return {"success": False, "error": "Could not locate LinkedIn post text editor"}

            # Wait 3 seconds for OpenGraph link preview to load
            time.sleep(3)

            print("[*] Clicking 'Post' button...")
            post_button_selectors = [
                "button.share-actions__primary-action",
                "button:has-text('Post')",
                ".share-box-footer button:has-text('Post')",
                "button[id*='ember']:has-text('Post')"
            ]
            post_clicked = False
            for sel in post_button_selectors:
                try:
                    btn = page.locator(sel).first
                    if btn.is_visible(timeout=3000) and btn.is_enabled():
                        btn.click()
                        post_clicked = True
                        break
                except Exception:
                    continue

            if not post_clicked:
                browser.close()
                return {"success": False, "error": "Could not click the Post button"}

            print("[*] Waiting for post confirmation...")
            time.sleep(4)
            # Re-save updated session cookies for freshness
            context.storage_state(path=str(SESSION_FILE))

            browser.close()
            print("[✅] Post successfully published to LinkedIn Personal Profile!")
            return {
                "success": True,
                "message": "Post successfully published to LinkedIn Personal Profile!",
                "timestamp": datetime.now().strftime("%Y-%m-%d %H:%M:%S")
            }

        except Exception as e:
            browser.close()
            return {"success": False, "error": f"LinkedIn posting failed: {str(e)}"}


if __name__ == "__main__":
    from datetime import datetime
    parser = argparse.ArgumentParser(description="LinkedIn Personal Profile Auto-Poster")
    parser.add_argument("--login", action="store_true", help="Launch visible browser for 1-time login")
    parser.add_argument("--email", type=str, default=DEFAULT_EMAIL, help="LinkedIn email")
    parser.add_argument("--check", action="store_true", help="Check session status")
    parser.add_argument("--post", action="store_true", help="Publish a post from JSON input")
    parser.add_argument("--article-json", type=str, help="Raw JSON string or file path containing article data")
    parser.add_argument("--headed", action="store_true", help="Run browser in visible mode for debugging")

    args = parser.parse_args()

    if args.login:
        res = run_login_flow(args.email)
        print(json.dumps(res, indent=2))
    elif args.check:
        res = check_session_status()
        print(json.dumps(res, indent=2))
    elif args.post:
        article = {}
        if args.article_json:
            if os.path.exists(args.article_json):
                with open(args.article_json, "r", encoding="utf-8") as f:
                    article = json.load(f)
            else:
                try:
                    article = json.loads(args.article_json)
                except Exception:
                    article = {"headline": args.article_json, "summary": ""}
        else:
            # Read from stdin
            try:
                article = json.load(sys.stdin)
            except Exception:
                article = {"headline": "Sri Lanka Business Update", "summary": "Test post from newsroom automation."}

        res = post_to_linkedin(article, headless=not args.headed)
        print(json.dumps(res, indent=2))
    else:
        parser.print_help()
