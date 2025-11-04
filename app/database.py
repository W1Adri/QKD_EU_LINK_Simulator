import hashlib
import sqlite3
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path
from typing import Iterator, List, Optional

"""Herramientas de persistencia para usuarios y mensajes de chat."""

BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = BASE_DIR / "data"
DB_PATH = DATA_DIR / "app.sqlite3"


@dataclass
class UserRecord:
    id: int
    username: str
    created_at: str


@dataclass
class ChatRecord:
    id: int
    user_id: int
    username: str
    message: str
    created_at: str


class UserAlreadyExistsError(RuntimeError):
    """La operación de creación chocó con un nombre de usuario duplicado."""


class UserNotFoundError(RuntimeError):
    """Se solicitó un usuario inexistente."""


def _hash_password(password: str) -> str:
    digest = hashlib.sha256()
    digest.update(password.encode("utf-8"))
    return digest.hexdigest()


def init_db() -> None:
    """Crea el archivo y las tablas necesarias si aún no existen."""

    DATA_DIR.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(DB_PATH) as conn:
        conn.execute("PRAGMA journal_mode=WAL;")
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT UNIQUE NOT NULL,
                password_hash TEXT NOT NULL,
                created_at TEXT NOT NULL DEFAULT (DATETIME('now'))
            );

            CREATE TABLE IF NOT EXISTS chats (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                message TEXT NOT NULL,
                created_at TEXT NOT NULL DEFAULT (DATETIME('now')),
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            );
            """
        )
        conn.commit()


@contextmanager
def get_connection() -> Iterator[sqlite3.Connection]:
    conn = sqlite3.connect(DB_PATH, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    try:
        yield conn
    finally:
        conn.close()


def create_user(username: str, password: str) -> UserRecord:
    password_hash = _hash_password(password)
    with get_connection() as conn:
        try:
            cursor = conn.execute(
                "INSERT INTO users (username, password_hash) VALUES (?, ?)",
                (username, password_hash),
            )
        except sqlite3.IntegrityError as exc:
            raise UserAlreadyExistsError(username) from exc
        user_id = cursor.lastrowid
        conn.commit()
        row = conn.execute(
            "SELECT id, username, created_at FROM users WHERE id = ?",
            (user_id,),
        ).fetchone()
    return UserRecord(**dict(row))


def get_user_by_username(username: str) -> Optional[UserRecord]:
    with get_connection() as conn:
        row = conn.execute(
            "SELECT id, username, created_at FROM users WHERE username = ?",
            (username,),
        ).fetchone()
    if row is None:
        return None
    return UserRecord(**dict(row))


def get_user_by_id(user_id: int) -> Optional[UserRecord]:
    with get_connection() as conn:
        row = conn.execute(
            "SELECT id, username, created_at FROM users WHERE id = ?",
            (user_id,),
        ).fetchone()
    if row is None:
        return None
    return UserRecord(**dict(row))


def verify_credentials(username: str, password: str) -> Optional[UserRecord]:
    password_hash = _hash_password(password)
    with get_connection() as conn:
        row = conn.execute(
            "SELECT id, username, created_at FROM users WHERE username = ? AND password_hash = ?",
            (username, password_hash),
        ).fetchone()
    if row is None:
        return None
    return UserRecord(**dict(row))


def store_chat_message(user_id: int, message: str) -> ChatRecord:
    with get_connection() as conn:
        cursor = conn.execute(
            "INSERT INTO chats (user_id, message) VALUES (?, ?)",
            (user_id, message),
        )
        chat_id = cursor.lastrowid
        conn.commit()
        row = conn.execute(
            """
            SELECT chats.id, chats.user_id, users.username, chats.message, chats.created_at
            FROM chats
            JOIN users ON users.id = chats.user_id
            WHERE chats.id = ?
            """,
            (chat_id,),
        ).fetchone()
    if row is None:
        raise RuntimeError("No se pudo recuperar el mensaje recién insertado")
    return ChatRecord(**dict(row))


def list_chat_messages(limit: int = 50) -> List[ChatRecord]:
    limit = max(1, min(limit, 500))
    with get_connection() as conn:
        rows = conn.execute(
            """
            SELECT chats.id, chats.user_id, users.username, chats.message, chats.created_at
            FROM chats
            JOIN users ON users.id = chats.user_id
            ORDER BY chats.created_at DESC, chats.id DESC
            LIMIT ?
            """,
            (limit,),
        ).fetchall()
    return [ChatRecord(**dict(row)) for row in rows][::-1]


def count_users() -> int:
    with get_connection() as conn:
        (count,) = conn.execute("SELECT COUNT(*) FROM users").fetchone()
    return int(count)


def count_chats() -> int:
    with get_connection() as conn:
        (count,) = conn.execute("SELECT COUNT(*) FROM chats").fetchone()
    return int(count)


def list_users() -> List[UserRecord]:
    with get_connection() as conn:
        rows = conn.execute(
            "SELECT id, username, created_at FROM users ORDER BY created_at ASC"
        ).fetchall()
    return [UserRecord(**dict(row)) for row in rows]
