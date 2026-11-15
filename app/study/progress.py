"""Progress, quiz performance and topic mastery: derived on read, never stored.

Inputs are plain rows from StudyStorage (lessons with progress, submitted quiz
attempts, Your turn attempts). Outputs contain IDs, titles, counts, scores and
timestamps only: never lesson text, answers or keys.

Mastery per lesson, lowest to highest:
  not_started  the lesson was never opened
  learning     opened, or quiz attempted, but not passed yet
  developing   quiz passed, but not on the first submitted attempt
  proficient   quiz passed on the first submitted attempt
  mastered     proficient with 3/3, and a "Your turn" verdict of correct within
               the first two attempts
Per module: once every lesson is completed, the lowest lesson level (the floor);
before that, developing if any lesson is completed, learning if any lesson was
opened, otherwise not_started.
"""

from collections import defaultdict
from datetime import datetime

LEVELS = ("not_started", "learning", "developing", "proficient", "mastered")
BLOOM = ("recall", "apply", "analyze")
RECENT_LIMIT = 20


def lesson_mastery(lesson: dict, attempts: list[dict], your_turn: list[str]) -> str:
    """attempts: this lesson's submitted quiz attempts; your_turn: verdicts, oldest first."""
    if lesson.get("opened_at") is None and not attempts:
        return "not_started"
    ordered = sorted(attempts, key=lambda a: a["attempt_number"])
    if not any(a["passed"] for a in ordered):
        return "learning"
    first = ordered[0]
    if not first["passed"]:
        return "developing"
    if first["score"] == 3 and "correct" in your_turn[:2]:
        return "mastered"
    return "proficient"


def module_mastery(lessons: list[dict], levels: dict) -> str:
    if lessons and all(lesson["status"] == "completed" for lesson in lessons):
        return min((levels[lesson["id"]] for lesson in lessons), key=LEVELS.index)
    if any(lesson["status"] == "completed" for lesson in lessons):
        return "developing"
    if any(levels[lesson["id"]] != "not_started" for lesson in lessons):
        return "learning"
    return "not_started"


def quiz_performance(attempts: list[dict]) -> dict:
    """Aggregates over submitted attempts; Bloom breakdown is graded server-side."""
    bloom = {level: {"questions": 0, "correct": 0} for level in BLOOM}
    by_lesson: dict = defaultdict(list)
    for attempt in attempts:
        by_lesson[attempt["lesson_id"]].append(attempt)
        answers = attempt.get("answers") or {}
        for question in attempt.get("questions") or []:
            level = question.get("bloom_level") if question.get("bloom_level") in BLOOM else "recall"
            bloom[level]["questions"] += 1
            bloom[level]["correct"] += answers.get(question.get("id")) == question.get("correct_option_id")
    firsts = [min(items, key=lambda a: a["attempt_number"]) for items in by_lesson.values()]
    count = len(attempts)
    return {
        "attempts": count,
        "passed": sum(1 for a in attempts if a["passed"]),
        "pass_rate": round(sum(1 for a in attempts if a["passed"]) / count, 3) if count else None,
        "first_try_pass_rate": (
            round(sum(1 for a in firsts if a["passed"]) / len(firsts), 3) if firsts else None
        ),
        "average_score": round(sum(a["score"] for a in attempts) / count, 2) if count else None,
        "bloom": bloom,
    }


def percent(done: int, total: int) -> int:
    return round(done * 100 / total) if total else 0


def _latest(*values):
    present = [v for v in values if isinstance(v, datetime)]
    return max(present) if present else None


def course_progress(course: dict, lessons: list[dict], attempts: list[dict],
                    your_turn: dict[str, list[str]]) -> dict:
    """lessons ordered by position, each with module_id/module_title/module_position."""
    by_lesson: dict = defaultdict(list)
    for attempt in attempts:
        by_lesson[attempt["lesson_id"]].append(attempt)
    levels = {
        lesson["id"]: lesson_mastery(lesson, by_lesson[lesson["id"]], your_turn.get(lesson["id"], []))
        for lesson in lessons
    }
    rows = []
    for lesson in lessons:
        tries = sorted(by_lesson[lesson["id"]], key=lambda a: a["attempt_number"])
        best = max(tries, key=lambda a: (a["passed"], a["score"]), default=None)
        rows.append({
            "id": lesson["id"],
            "module_id": lesson["module_id"],
            "position": lesson["position"],
            "title": lesson["title"],
            "status": lesson["status"],
            "estimated_minutes": lesson["estimated_minutes"],
            "opened_at": lesson.get("opened_at"),
            "completed_at": lesson.get("completed_at"),
            "study_seconds": lesson.get("study_seconds", 0),
            "quiz_attempts": len(tries),
            "first_try_pass": tries[0]["passed"] if tries else None,
            "best_score": best["score"] if best else None,
            "last_score": tries[-1]["score"] if tries else None,
            "passed": any(a["passed"] for a in tries),
            "mastery": levels[lesson["id"]],
        })
    modules: dict = {}
    for lesson in lessons:
        modules.setdefault(lesson["module_id"], {
            "id": lesson["module_id"], "title": lesson["module_title"],
            "position": lesson["module_position"], "lessons": [],
        })["lessons"].append(lesson)
    module_rows = []
    for module in sorted(modules.values(), key=lambda m: m["position"]):
        ids = {lesson["id"] for lesson in module["lessons"]}
        done = sum(1 for lesson in module["lessons"] if lesson["status"] == "completed")
        module_rows.append({
            "id": module["id"],
            "title": module["title"],
            "position": module["position"],
            "completed_lessons": done,
            "lesson_count": len(module["lessons"]),
            "percent": percent(done, len(module["lessons"])),
            "mastery": module_mastery(module["lessons"], levels),
            "quiz": quiz_performance([a for a in attempts if a["lesson_id"] in ids]),
        })
    completed = sum(1 for lesson in lessons if lesson["status"] == "completed")
    following = next(
        (lesson["id"] for lesson in lessons if lesson["status"] in ("available", "in_progress")), None
    )
    last_activity = _latest(
        *(lesson.get("opened_at") for lesson in lessons),
        *(lesson.get("completed_at") for lesson in lessons),
        *(lesson.get("last_study_at") for lesson in lessons),
        *(attempt.get("submitted_at") for attempt in attempts),
    )
    distribution = {level: 0 for level in LEVELS}
    for level in levels.values():
        distribution[level] += 1
    return {
        "course_id": course["id"],
        "title": course["title"],
        "percent": percent(completed, len(lessons)),
        "completed_lessons": completed,
        "lesson_count": len(lessons),
        "estimated_minutes_remaining": sum(
            lesson["estimated_minutes"] for lesson in lessons if lesson["status"] != "completed"
        ),
        "study_seconds": sum(lesson.get("study_seconds", 0) for lesson in lessons),
        "next_lesson_id": following,
        "last_activity": last_activity,
        "mastery_distribution": distribution,
        "quiz": quiz_performance(attempts),
        "modules": module_rows,
        "lessons": rows,
    }


def summary(progress: dict) -> dict:
    """The compact block embedded in GET /courses for library cards."""
    return {key: progress[key] for key in (
        "percent", "completed_lessons", "lesson_count", "estimated_minutes_remaining",
        "study_seconds", "last_activity", "mastery_distribution",
    )}


def overview(entries: list[tuple[dict, list[dict]]]) -> dict:
    """entries: (course_progress() result, that course's submitted attempts).

    Cards sort by most recent activity; the recent list is bounded and holds IDs,
    titles, scores and timestamps only."""
    courses = [course for course, _ in entries]
    recent = []
    for course, attempts in entries:
        titles = {row["id"]: row["title"] for row in course["lessons"]}
        for row in course["lessons"]:
            if row["completed_at"]:
                recent.append({"kind": "lesson_completed", "course_id": course["course_id"],
                               "lesson_id": row["id"], "title": row["title"], "at": row["completed_at"]})
        for attempt in attempts:
            recent.append({"kind": "quiz", "course_id": course["course_id"],
                           "lesson_id": attempt["lesson_id"], "title": titles.get(attempt["lesson_id"], ""),
                           "score": attempt["score"], "passed": attempt["passed"],
                           "at": attempt["submitted_at"]})
    recent.sort(key=lambda item: (item["at"] is not None, item["at"]), reverse=True)
    cards = sorted(courses, key=lambda c: (c["last_activity"] is not None, c["last_activity"]),
                   reverse=True)
    return {
        "totals": {
            "courses": len(courses),
            "lessons_completed": sum(c["completed_lessons"] for c in courses),
            "lessons_total": sum(c["lesson_count"] for c in courses),
            "study_seconds": sum(c["study_seconds"] for c in courses),
        },
        "courses": [
            {"course_id": c["course_id"], "title": c["title"], "percent": c["percent"],
             "completed_lessons": c["completed_lessons"], "lesson_count": c["lesson_count"],
             "study_seconds": c["study_seconds"], "mastery_distribution": c["mastery_distribution"],
             "last_activity": c["last_activity"], "next_lesson_id": c["next_lesson_id"]}
            for c in cards
        ],
        "recent": recent[:RECENT_LIMIT],
    }
