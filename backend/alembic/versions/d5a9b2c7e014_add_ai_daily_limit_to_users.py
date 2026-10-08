"""add ai_daily_limit to users

Revision ID: d5a9b2c7e014
Revises: c4e8a1d63b77
Create Date: 2026-10-08 09:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'd5a9b2c7e014'
down_revision: Union[str, None] = 'c4e8a1d63b77'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('users', sa.Column('ai_daily_limit', sa.Integer(), nullable=True))


def downgrade() -> None:
    op.drop_column('users', 'ai_daily_limit')
