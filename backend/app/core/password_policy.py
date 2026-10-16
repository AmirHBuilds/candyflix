"""A simple rule against passwords that are guessed first. Length (8+) is checked by the request schemas; this adds the rest.

Not a strength meter: it only refuses what a guesser tries before anything else."""

_COMMON = {
    "password", "password1", "password12", "password123", "password1234", "passw0rd", "p@ssw0rd", "p@ssword",
    "12345678", "123456789", "1234567890", "123123123", "11111111", "00000000", "87654321", "12341234", "123456789a",
    "qwertyui", "qwerty123", "qwertyuiop", "qwerty12", "1q2w3e4r", "1q2w3e4r5t", "q1w2e3r4", "asdfghjk", "asdfghjkl", "zxcvbnm1",
    "iloveyou", "iloveyou1", "iloveyou2", "letmein1", "welcome1", "welcome123", "admin123", "administrator",
    "abc12345", "abcd1234", "abcdefgh", "monkey123", "dragon123", "football1", "baseball1", "superman1", "sunshine1",
    "princess1", "trustno1", "changeme", "changeme1", "candyflix", "candyflix1", "candyflix123", "candy123", "candy1234", "netflix123",
}


def problem(password: str, username: str | None = None) -> str | None:
    """Why this password shouldn't be used, or None if it is fine."""
    p = password.strip().lower()
    if p in _COMMON:
        return "That password is one of the first ones anyone would try. Please pick something less common."
    if len(set(p)) <= 2:
        return "That password is too repetitive. Please mix it up."
    if p.isdigit():
        return "A password of only numbers is easy to guess. Please add some letters."
    if username and len(username) >= 3 and p in (username.lower(), username.lower() + "123", username.lower() + "1234"):
        return "Your password shouldn't be your username."
    return None
