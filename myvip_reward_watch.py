#!/usr/bin/env python3

import json
import html as html_lib
import os
import re
import sys
import subprocess
from datetime import datetime
from pathlib import Path
from urllib.request import Request, urlopen
from urllib.error import URLError, HTTPError

API_URL = "https://loyalty-award-api.myvip.co/api/proxy/rewards/section/destination/8"
REWARD_DETAIL_URL = "https://loyalty-award-api.myvip.co/api/proxy/rewards/award/{offer_id}"

SNAPSHOT_DIR = Path(
    os.environ.get("MYVIP_SNAPSHOT_DIR", Path.home() / "myvip-reward-snapshots")
)
LATEST_FILE = SNAPSHOT_DIR / "latest.json"
WEBSITE_DATA_FILE = Path(
    os.environ.get("MYVIP_SITE_DIR", Path.home() / "myvip-reward-site")
) / "rewards.json"

CHANGE_FIELDS = [
    "OfferID", "Partner", "Reward title", "Port", "Points", "Quantity",
    "SnipeText", "SnipeCategory", "StrikeOutPrice", "ExpireTime", "IsPremium",
    "RewardDescription",
    "RewardUseByText",
    "RewardPageLimitText",
    "RewardTermsText",
    "RewardTermsExtractedAt",
    "DeparturePorts", "Sailings", "Ships",
]

WEBSITE_FIELDS = [
    "AwardID",
    "OfferID",
    "Partner",
    "Reward title",
    "RewardPageTitle",
    "Port",
    "Points",
    "PointHistory",
    "FirstObserved",
    "Quantity",
    "HighestQuantityObserved",
    "SnipeText",
    "SnipeCategory",
    "StrikeOutPrice",
    "ExpireTime",
    "DeparturePorts",
    "Sailings",
    "Ships",
    "IsPremium",
    "RewardURL",
    "ImageURL",
    "RewardDescription",
    "RewardUseByText",
    "RewardPageLimitText",
    "RewardTermsText",
    "RewardTermsExtractedAt",
    "ArushaNotes",
    "PointHistoryNote",
    "ChangeHistory",
]

SAN_DIEGO_NOTE_40273 = (
    "I redeemed this deal on 19 Jun 2026 and used it for a cruise from Istanbul "
    "despite it saying it was for sailings from San Diego. I don't know if San Diego "
    "is a mistake or they were just bending the rules for me. You can call the number "
    "in the Ts & Cs and double check validity before purchasing the reward."
)

MANUAL_REWARD_NOTES_BY_OFFER_ID = {
    40273: SAN_DIEGO_NOTE_40273,
}


def fetch_json(url: str) -> dict:
    request = Request(
        url,
        headers={
            "User-Agent": "Mozilla/5.0",
            "Accept": "application/json",
        },
    )

    with urlopen(request, timeout=30) as response:
        return json.loads(response.read().decode("utf-8"))


def clean_detail_text(value: str | None) -> str | None:
    if not value:
        return None

    text = re.sub(r"<br\s*/?>", "\n", value, flags=re.IGNORECASE)
    text = re.sub(r"</p\s*>", "\n\n", text, flags=re.IGNORECASE)
    text = re.sub(r"</div\s*>", "\n", text, flags=re.IGNORECASE)
    text = re.sub(r"<[^>]+>", "", text)
    text = html_lib.unescape(text)
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n[ \t]+", "\n", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip() or None


def apply_manual_reward_notes(website_reward: dict) -> None:
    note = MANUAL_REWARD_NOTES_BY_OFFER_ID.get(website_reward.get("OfferID"))
    if not note:
        return

    notes = [
        existing_note
        for existing_note in (website_reward.get("ArushaNotes") or [])
        if existing_note
    ]
    if note not in notes:
        notes.append(note)

    website_reward["ArushaNotes"] = notes
    website_reward["PointHistoryNote"] = note


def strip_reward_symbol(value: str | None) -> str | None:
    if not value:
        return None
    return re.sub(r"\s*[®™]\s*", "", value).strip(" .") or None


def unique_join(values: list[str | None]) -> str | None:
    cleaned = []
    seen = set()
    for value in values:
        clean_value = strip_reward_symbol(re.sub(r"\s+", " ", value).strip(" .")) if value else None
        if not clean_value:
            continue
        key = clean_value.casefold()
        if key in seen:
            continue
        seen.add(key)
        cleaned.append(clean_value)
    return ", ".join(cleaned) or None


def is_plausible_departure_port(value: str | None) -> bool:
    if not value:
        return False
    return not re.search(
        r"\b(myvip|myvegas|reward|offer|royal caribbean|norwegian cruise line|virgin voyages|reservation|purchase|redeem|casino royale)\b",
        value,
        flags=re.IGNORECASE,
    )


def extract_detail_columns(reward: dict) -> None:
    description = reward.get("RewardDescription") or ""
    terms = reward.get("RewardTermsText") or ""

    departure_ports = None
    for pattern in (
        r"\bout of\s+(.+?)\s+for\s+\d+\s+nights?\s+sailing\b",
        r"\bfrom\s+(.+?)\s+to\s+.+?\bsail\b",
        r"\bfrom ports in\s+(.+?)\.",
    ):
        match = re.search(pattern, description, flags=re.IGNORECASE | re.DOTALL)
        if match:
            possible_departure_ports = re.sub(r"\s+", " ", match.group(1)).strip(" .")
            if is_plausible_departure_port(possible_departure_ports):
                departure_ports = possible_departure_ports
                break
    if not departure_ports:
        match = re.search(
            r"\bdepart(?:ing|ure)\s+from\s+(.+?)(?:\.|,|;|\s+by\b|\s+on\b)",
            terms,
            flags=re.IGNORECASE | re.DOTALL,
        )
        if match:
            possible_departure_ports = re.sub(r"\s+", " ", match.group(1)).strip(" .")
            if is_plausible_departure_port(possible_departure_ports):
                departure_ports = possible_departure_ports

    sailings = None
    sailing_matches = re.findall(
        r"\bsailing on\s+([0-9]{1,2}/[0-9]{1,2}/[0-9]{4})",
        description,
        flags=re.IGNORECASE,
    )
    if sailing_matches:
        sailings = ", ".join(dict.fromkeys(sailing_matches))
    else:
        match = re.search(
            r"\b(?:select sailings|sail from now)\s+through\s+(.+?)(?:\s+on\b|[.;]|$)",
            description,
            flags=re.IGNORECASE,
        )
        if match:
            sailings = f"Select sailings through {match.group(1).strip()}"
    if not sailings:
        match = re.search(
            r"\bvalid\s+for\s+sailings\s+departing\s+by\s+(.+?)(?:\.|;|$)",
            terms,
            flags=re.IGNORECASE,
        )
        if match:
            sailings = f"Sailings departing by {match.group(1).strip()}"

    ships = None
    ship_matches = []
    ship_matches.extend(re.findall(
        r"\bon\s+(?:Royal Caribbeans\s+|Royal Caribbean's\s+)?([A-Z][A-Za-z'’]+\s+of\s+the\s+Seas)\b",
        description,
    ))
    ship_matches.extend(re.findall(
        r"\bon\s+(?:The\s+)?(Norwegian\s+[A-Z][A-Za-z'’]+)\b",
        description,
    ))
    if re.search(r"\bLady Ships\b", terms, flags=re.IGNORECASE):
        ship_matches.append("Virgin Voyages Lady Ships")
    exclusion_matches = [
        f"Excludes {ship}"
        for ship in re.findall(
            r"\bnot\s+valid\s+on\s+(.+?)\s+sailings\b",
            terms,
            flags=re.IGNORECASE,
        )
    ]
    ships = unique_join(ship_matches + exclusion_matches)

    reward["DeparturePorts"] = departure_ports or (
        reward.get("DeparturePorts") if is_plausible_departure_port(reward.get("DeparturePorts")) else None
    )
    reward["Sailings"] = sailings or reward.get("Sailings")
    reward["Ships"] = ships or reward.get("Ships")


def extract_use_by_text(popouts: list[dict] | None) -> str | None:
    for popout in popouts or []:
        title = clean_detail_text(popout.get("Title"))
        if not title or not re.search(r"learn\s+more", title, re.IGNORECASE):
            continue

        body = popout.get("Body") or ""
        for block in re.split(r"\r?\n\r?\n", body):
            parts = re.split(r"\r?\n", block, maxsplit=1)
            heading = parts[0]
            content = parts[1] if len(parts) > 1 else ""
            heading = clean_detail_text(heading)
            if content and heading and re.search(r"use\s+by\s+date", heading, re.IGNORECASE):
                use_by_text = clean_detail_text(content)
                if use_by_text:
                    return re.sub(
                        r"^Must be redeemed",
                        "This reward must be redeemed",
                        use_by_text,
                        flags=re.IGNORECASE,
                    )

    return None


def split_detail_sentences(text: str | None) -> list[str]:
    if not text:
        return []
    compact_text = re.sub(r"\s+", " ", text).strip()
    return [
        sentence.strip()
        for sentence in re.findall(r"[^.!?]+[.!?]+|[^.!?]+$", compact_text)
        if sentence.strip()
    ]


def extract_page_limit_text(detail: dict) -> str | None:
    """Extract useful redemption-limit text from page sections outside Ts & Cs."""
    snippets = []
    for popout in detail.get("Popouts") or []:
        title = clean_detail_text(popout.get("Title")) or ""
        if re.search(r"terms\s+and\s+conditions", title, re.IGNORECASE):
            continue
        body = clean_detail_text(popout.get("Body"))
        if body:
            body = re.sub(
                r"\b(?:Use by Date|Customer Redemption Steps|Pre-Purchase)\b",
                ". ",
                body,
                flags=re.IGNORECASE,
            )
            snippets.append(body)

    useful_sentences = []
    seen = set()
    for sentence in split_detail_sentences(" ".join(snippets)):
        lower_sentence = sentence.casefold()
        is_limit = (
            re.search(r"\blimit(?:ed)?\b", lower_sentence)
            and (
                re.search(r"\bper\b", lower_sentence)
                or re.search(r"\b\d+\s+purchases?\b", lower_sentence)
                or re.search(r"\b\d+\s+days?\b", lower_sentence)
            )
        )
        if not is_limit:
            continue
        key = lower_sentence
        if key in seen:
            continue
        seen.add(key)
        useful_sentences.append(sentence)

    return " ".join(useful_sentences) or None


def extract_terms_text(detail: dict) -> str | None:
    for popout in detail.get("Popouts") or []:
        title = clean_detail_text(popout.get("Title"))
        if title and re.search(r"terms\s+and\s+conditions", title, re.IGNORECASE):
            terms_text = clean_detail_text(popout.get("Body"))
            if terms_text:
                return terms_text

    return clean_detail_text(detail.get("TermsAndConditionsExtended"))


def enrich_rewards_with_detail(rewards: dict, checked_at: str | None = None) -> None:
    detail_cache = {}

    for reward in rewards.values():
        offer_id = reward.get("OfferID")
        if offer_id in (None, ""):
            continue

        offer_key = str(offer_id)
        if offer_key not in detail_cache:
            try:
                detail_cache[offer_key] = fetch_json(REWARD_DETAIL_URL.format(offer_id=offer_key))
            except (HTTPError, URLError, json.JSONDecodeError, TimeoutError, OSError) as e:
                print(f"Could not fetch reward detail for offer {offer_key}: {e}", file=sys.stderr)
                detail_cache[offer_key] = None

        detail = detail_cache.get(offer_key)
        if not isinstance(detail, dict):
            continue

        reward["RewardPageTitle"] = clean_detail_text(detail.get("Title")) or reward.get("RewardPageTitle")
        reward["ImageURL"] = detail.get("ImageURL") or detail.get("GalleryImageURL") or reward.get("ImageURL")
        reward["RewardDescription"] = (
            clean_detail_text(detail.get("Description"))
            or clean_detail_text(detail.get("ShortDescription"))
            or reward.get("RewardDescription")
        )
        reward["RewardUseByText"] = extract_use_by_text(detail.get("Popouts"))
        reward["RewardPageLimitText"] = extract_page_limit_text(detail)
        reward["RewardTermsText"] = extract_terms_text(detail)
        if reward.get("RewardTermsText"):
            reward["RewardTermsExtractedAt"] = checked_at or datetime.now().astimezone().isoformat(timespec="seconds")
        extract_detail_columns(reward)


def extract_rewards(data: dict) -> dict:
    """
    Returns rewards keyed by AwardID.
    This deduplicates rewards that appear in multiple lanes.
    """
    rewards = {}

    for lane in data.get("Lanes", []):
        for award in lane.get("Awards", []) or []:
            award_id = str(award.get("AwardID"))

            if not award_id or award_id == "None":
                continue

            partner = (award.get("PartnerName") or "").strip()
            title = (award.get("Title") or "").strip()

            port = (
                award.get("LocationName")
                or award.get("OutletName")
                or award.get("PropertyName")
                or ""
            ).strip()

            rewards[award_id] = {
                "AwardID": award.get("AwardID"),
                "OfferID": award.get("OfferID"),
                "Partner": partner,
                "Reward title": title,
                "RewardPageTitle": None,
                "Port": port,
                "Points": award.get("Price"),
                "Quantity": award.get("Quantity"),
                "SnipeText": award.get("SnipeText"),
                "SnipeCategory": award.get("SnipeCategory"),
                "StrikeOutPrice": award.get("StrikeOutPrice"),
                "ExpireTime": award.get("ExpireTime"),
                "DeparturePorts": None,
                "Sailings": None,
                "Ships": None,
                "IsPremium": award.get("IsPremium"),
                "RewardURL": award.get("ForwardLink"),
                "ImageURL": award.get("ImageURL") or award.get("GalleryImageURL"),
                "RewardDescription": award.get("ShortDescription"),
                "RewardUseByText": None,
                "RewardPageLimitText": None,
            }

    return rewards


def load_previous_snapshot() -> dict | None:
    if not LATEST_FILE.exists():
        return None

    with LATEST_FILE.open("r", encoding="utf-8") as f:
        return json.load(f)


def save_snapshot(rewards: dict, checked_at: str) -> None:
    SNAPSHOT_DIR.mkdir(parents=True, exist_ok=True)

    timestamp = re.sub(r"[^0-9A-Za-z]+", "_", checked_at).strip("_")
    dated_file = SNAPSHOT_DIR / f"snapshot_{timestamp}.json"

    payload = {
        "checked_at": checked_at,
        "source_url": API_URL,
        "rewards": rewards,
    }

    with dated_file.open("w", encoding="utf-8") as f:
        json.dump(payload, f, indent=2, ensure_ascii=False)

    with LATEST_FILE.open("w", encoding="utf-8") as f:
        json.dump(payload, f, indent=2, ensure_ascii=False)


def save_website_data(rewards: dict, checked_at: str) -> None:
    """Write a stable, sorted data file for the local rewards website."""
    WEBSITE_DATA_FILE.parent.mkdir(parents=True, exist_ok=True)

    previous_highs = {}
    previous_point_histories = {}
    previous_change_histories = {}
    previous_check_history = []
    previous_rewards = []
    previous_checked_at = None
    if WEBSITE_DATA_FILE.exists():
        try:
            with WEBSITE_DATA_FILE.open("r", encoding="utf-8") as f:
                previous_payload = json.load(f)
            previous_rewards = previous_payload.get("rewards", [])
            previous_checked_at = previous_payload.get("checked_at")
            if isinstance(previous_payload.get("check_history"), list):
                previous_check_history = [
                    value for value in previous_payload["check_history"]
                    if isinstance(value, str) and value
                ]
            for reward in previous_rewards:
                award_id = str(reward.get("AwardID"))
                quantities = [
                    reward.get("Quantity"),
                    reward.get("HighestQuantityObserved"),
                ]
                numeric_quantities = [
                    value for value in quantities
                    if isinstance(value, (int, float)) and not isinstance(value, bool)
                ]
                if numeric_quantities:
                    previous_highs[award_id] = max(numeric_quantities)
                history = reward.get("PointHistory")
                if isinstance(history, list):
                    previous_point_histories[award_id] = [
                        entry for entry in history
                        if isinstance(entry, dict)
                        and entry.get("observed_at")
                        and "value" in entry
                    ]
                change_history = reward.get("ChangeHistory")
                if isinstance(change_history, list):
                    previous_change_histories[award_id] = [
                        event for event in change_history
                        if isinstance(event, dict)
                        and event.get("observed_at")
                        and isinstance(event.get("changes"), list)
                    ]
        except (OSError, json.JSONDecodeError, AttributeError):
            # A damaged website file should not prevent fresh data being written.
            previous_highs = {}
            previous_point_histories = {}
            previous_change_histories = {}
            previous_check_history = []

    snapshot_point_histories = {}
    snapshot_change_histories = {}
    snapshot_previous_rewards = {}
    snapshot_check_history = []
    for snapshot_file in sorted(SNAPSHOT_DIR.glob("snapshot_*.json")):
        try:
            with snapshot_file.open("r", encoding="utf-8") as f:
                snapshot = json.load(f)
            observed_at = snapshot.get("checked_at")
            if not observed_at:
                continue
            if not snapshot_check_history or snapshot_check_history[-1] != observed_at:
                snapshot_check_history.append(observed_at)
            for award_id, reward in snapshot.get("rewards", {}).items():
                award_id = str(award_id)
                value = reward.get("Points")
                history = snapshot_point_histories.setdefault(award_id, [])
                if not history or history[-1]["value"] != value:
                    history.append({"observed_at": observed_at, "value": value})
                previous_snapshot_reward = snapshot_previous_rewards.get(award_id)
                if previous_snapshot_reward is not None:
                    changes = [
                        {
                            "field": field,
                            "from": previous_snapshot_reward.get(field),
                            "to": reward.get(field),
                        }
                        for field in CHANGE_FIELDS
                        if previous_snapshot_reward.get(field) != reward.get(field)
                    ]
                    if changes:
                        snapshot_change_histories.setdefault(award_id, []).append({
                            "observed_at": observed_at,
                            "changes": changes,
                        })
                snapshot_previous_rewards[award_id] = reward
        except (OSError, json.JSONDecodeError, AttributeError):
            continue

    check_history = list(previous_check_history or snapshot_check_history)
    if not check_history or check_history[-1] != checked_at:
        check_history.append(checked_at)

    previous_rewards_by_id = {
        str(reward.get("AwardID")): reward for reward in previous_rewards
    }

    website_rewards = []
    for reward in rewards.values():
        website_reward = {field: reward.get(field) for field in WEBSITE_FIELDS}
        award_id = str(reward.get("AwardID"))
        previous_reward = previous_rewards_by_id.get(award_id)
        if not website_reward.get("RewardPageTitle") and previous_reward:
            website_reward["RewardPageTitle"] = previous_reward.get("RewardPageTitle")
        if not website_reward.get("RewardPageTitle"):
            website_reward["RewardPageTitle"] = reward.get("Reward title")
        if not website_reward.get("RewardDescription") and previous_reward:
            website_reward["RewardDescription"] = previous_reward.get("RewardDescription")
        if not website_reward.get("RewardUseByText") and previous_reward:
            website_reward["RewardUseByText"] = previous_reward.get("RewardUseByText")
        if not website_reward.get("RewardPageLimitText") and previous_reward:
            website_reward["RewardPageLimitText"] = previous_reward.get("RewardPageLimitText")
        if not website_reward.get("RewardTermsText") and previous_reward:
            website_reward["RewardTermsText"] = previous_reward.get("RewardTermsText")
        if not website_reward.get("RewardTermsExtractedAt") and previous_reward:
            website_reward["RewardTermsExtractedAt"] = previous_reward.get("RewardTermsExtractedAt")
        if not website_reward.get("ImageURL") and previous_reward:
            website_reward["ImageURL"] = previous_reward.get("ImageURL")
        for detail_field in ("DeparturePorts", "Sailings", "Ships"):
            if not website_reward.get(detail_field) and previous_reward:
                website_reward[detail_field] = previous_reward.get(detail_field)
        if previous_reward and previous_reward.get("ArushaNotes"):
            website_reward["ArushaNotes"] = previous_reward.get("ArushaNotes")
        if previous_reward and previous_reward.get("PointHistoryNote"):
            website_reward["PointHistoryNote"] = previous_reward.get("PointHistoryNote")
        apply_manual_reward_notes(website_reward)
        if previous_reward and previous_reward.get("FirstObserved"):
            website_reward["FirstObserved"] = previous_reward.get("FirstObserved")
        elif not previous_reward:
            website_reward["FirstObserved"] = checked_at
        elif not website_reward.get("FirstObserved"):
            website_reward["FirstObserved"] = "Unknown"
        current_quantity = reward.get("Quantity")
        observed_quantities = [previous_highs.get(award_id)]
        if isinstance(current_quantity, (int, float)) and not isinstance(current_quantity, bool):
            observed_quantities.append(current_quantity)
        numeric_quantities = [value for value in observed_quantities if value is not None]
        website_reward["HighestQuantityObserved"] = (
            max(numeric_quantities) if numeric_quantities else None
        )

        point_history = list(
            previous_point_histories.get(award_id)
            or snapshot_point_histories.get(award_id)
            or []
        )
        if not point_history and previous_reward and previous_checked_at:
            point_history.append({
                "observed_at": previous_checked_at,
                "value": previous_reward.get("Points"),
            })
        current_points = reward.get("Points")
        if not point_history or point_history[-1].get("value") != current_points:
            point_history.append({
                "observed_at": checked_at,
                "value": current_points,
            })
        website_reward["PointHistory"] = point_history

        change_history = list(
            previous_change_histories.get(award_id)
            or snapshot_change_histories.get(award_id)
            or []
        )
        if previous_reward is not None and previous_change_histories.get(award_id) is not None:
            changes = [
                {
                    "field": field,
                    "from": previous_reward.get(field),
                    "to": reward.get(field),
                }
                for field in CHANGE_FIELDS
                if previous_reward.get(field) != reward.get(field)
            ]
            if changes:
                change_history.append({
                    "observed_at": checked_at,
                    "changes": changes,
                })
        website_reward["ChangeHistory"] = change_history
        website_rewards.append(website_reward)

    sorted_rewards = sorted(
        website_rewards,
        key=lambda reward: (
            (reward.get("Partner") or "").casefold(),
            reward.get("Points") if isinstance(reward.get("Points"), (int, float)) else float("inf"),
        ),
    )

    payload = {
        "checked_at": checked_at,
        "check_history": check_history,
        "source_url": API_URL,
        "rewards": sorted_rewards,
    }

    temporary_file = WEBSITE_DATA_FILE.with_suffix(".json.tmp")
    with temporary_file.open("w", encoding="utf-8") as f:
        json.dump(payload, f, indent=2, ensure_ascii=False)
        f.write("\n")
    temporary_file.replace(WEBSITE_DATA_FILE)


def reward_label(reward: dict) -> str:
    return f"{reward.get('Partner')} — {reward.get('Reward title')} — {reward.get('Port')}"


def compare_rewards(previous_payload: dict | None, current_rewards: dict) -> list[str]:
    if previous_payload is None:
        return ["No previous snapshot found. Saved today’s rewards as the baseline."]

    previous_rewards = previous_payload.get("rewards", {})

    previous_ids = set(previous_rewards.keys())
    current_ids = set(current_rewards.keys())

    messages = []

    added_ids = sorted(current_ids - previous_ids)
    removed_ids = sorted(previous_ids - current_ids)

    for award_id in added_ids:
        reward = current_rewards[award_id]
        messages.append(
            f"ADDED: {reward_label(reward)} — {reward.get('Points'):,} points"
        )

    for award_id in removed_ids:
        reward = previous_rewards[award_id]
        messages.append(
            f"REMOVED: {reward_label(reward)} — was {reward.get('Points'):,} points"
        )

    fields_to_watch = CHANGE_FIELDS

    for award_id in sorted(previous_ids & current_ids):
        old = previous_rewards[award_id]
        new = current_rewards[award_id]

        changes = []

        for field in fields_to_watch:
            if old.get(field) != new.get(field):
                changes.append(f"{field}: {old.get(field)} → {new.get(field)}")

        if changes:
            messages.append(
                f"CHANGED: {reward_label(new)}\n  " + "\n  ".join(changes)
            )

    if not messages:
        messages.append("No changes found.")

    return messages

def notify_mac(title: str, message: str) -> None:
    """
    Shows a macOS notification.
    """
    if os.environ.get("MYVIP_DISABLE_NOTIFICATIONS") or sys.platform != "darwin":
        return

    subprocess.run(
        [
            "osascript",
            "-e",
            "on run argv",
            "-e",
            "display notification (item 1 of argv) with title (item 2 of argv)",
            "-e",
            "end run",
            message,
            title,
        ],
        check=False
    )

def main() -> int:
    checked_at = datetime.now().astimezone().isoformat(timespec="seconds")
    try:
        data = fetch_json(API_URL)
    except HTTPError as e:
        print(f"HTTP error while fetching API: {e.code} {e.reason}")
        return 1
    except URLError as e:
        print(f"Network error while fetching API: {e.reason}")
        return 1
    except json.JSONDecodeError:
        print("The API response was not valid JSON.")
        return 1

    current_rewards = extract_rewards(data)
    enrich_rewards_with_detail(current_rewards, checked_at)
    previous_payload = load_previous_snapshot()

    messages = compare_rewards(previous_payload, current_rewards)
    save_snapshot(current_rewards, checked_at)
    save_website_data(current_rewards, checked_at)

    print(f"Checked {len(current_rewards)} unique rewards.")
    print()

    for message in messages:
        print(message)
        print()

    meaningful_changes = [
        message for message in messages
        if not message.startswith("No previous snapshot")
        and message != "No changes found."
    ]

    if meaningful_changes:
        preview = meaningful_changes[0]

        if len(meaningful_changes) > 1:
            preview += f"\n\nPlus {len(meaningful_changes) - 1} more change(s)."

        notify_mac("myVIP rewards changed", preview)
    else:
        notify_mac(
            "myVIP rewards checked",
            f"No changes found. Checked {len(current_rewards)} unique rewards."
        )

    print(f"Snapshot saved in: {SNAPSHOT_DIR}")
    print(f"Website data saved to: {WEBSITE_DATA_FILE}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
