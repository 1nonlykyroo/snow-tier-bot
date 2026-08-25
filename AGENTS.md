# Snow Tier Agent Notes

## Phase Discipline

- Implement only the currently requested phase.
- Do not skip ahead into queue, testing, review, or cooldown features unless explicitly requested.

## Architecture Direction

- Keep Discord interaction handling modular.
- Keep PostgreSQL as the source of truth for persistent state.
- Centralize validation, constants, and error handling.
- Prefer small services and repositories as later phases add business logic.
