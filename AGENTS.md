# Documenting AI usage

Please write every usage to [AI.md](./AI.md). 
Make sure to include attribution author. Use `gh` to extract that information.

# Tests

Do not generate tests unless explicitly asked.

# Backend

Follow vertical slices architecture. Group closely related code together inside proper named directories.
Every new slice should expose single `APIRouter` which can be later attached inside the [main.py](backend/main.py).
Keep the files concise. Avoid using vouge type annotations such as `Any`, `Object`.