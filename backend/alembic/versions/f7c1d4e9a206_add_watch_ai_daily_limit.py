"""add watch_ai_daily_limit to users

Revision ID: f7c1d4e9a206
Revises: e6b0c3d8f125
Create Date: 2026-10-09 07:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'f7c1d4e9a206'
down_revision: Union[str, None] = 'e6b0c3d8f125'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('users', sa.Column('watch_ai_daily_limit', sa.Integer(), nullable=True))


def downgrade() -> None:
    op.drop_column('users', 'watch_ai_daily_limit')
