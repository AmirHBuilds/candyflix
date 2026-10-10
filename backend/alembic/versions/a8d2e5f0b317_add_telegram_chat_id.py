"""add telegram_chat_id to users (two-step sign-in)

Revision ID: a8d2e5f0b317
Revises: f7c1d4e9a206
Create Date: 2026-10-09 18:30:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'a8d2e5f0b317'
down_revision: Union[str, None] = 'f7c1d4e9a206'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('users', sa.Column('telegram_chat_id', sa.BigInteger(), nullable=True))
    op.create_unique_constraint('uq_users_telegram_chat_id', 'users', ['telegram_chat_id'])


def downgrade() -> None:
    op.drop_constraint('uq_users_telegram_chat_id', 'users', type_='unique')
    op.drop_column('users', 'telegram_chat_id')
