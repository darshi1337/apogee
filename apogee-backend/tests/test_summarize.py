from apogee.routes.summarize import _parse_suggested_questions


def test_parse_suggested_questions_basic():
    text = "1. What is the main thesis?\n2. How is this validated?"
    assert _parse_suggested_questions(text) == [
        "What is the main thesis?",
        "How is this validated?",
    ]


def test_parse_suggested_questions_bullets():
    text = "- What is the main thesis?\n* How is this validated?"
    assert _parse_suggested_questions(text) == [
        "What is the main thesis?",
        "How is this validated?",
    ]


def test_parse_suggested_questions_with_intro():
    text = (
        "Here are two suggested questions:\n"
        "- What is the main thesis?\n"
        "- How is this validated?"
    )
    assert _parse_suggested_questions(text) == [
        "What is the main thesis?",
        "How is this validated?",
    ]


def test_parse_suggested_questions_non_questions():
    text = (
        "1. This is not a question.\n"
        "1. What is the main thesis?\n"
        "2. How is this validated?"
    )
    assert _parse_suggested_questions(text) == [
        "What is the main thesis?",
        "How is this validated?",
    ]
