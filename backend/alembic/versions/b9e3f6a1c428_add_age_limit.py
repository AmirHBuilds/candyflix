"""add age_limit to users

Revision ID: b9e3f6a1c428
Revises: a8d2e5f0b317
Create Date: 2026-10-10 09:40:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'b9e3f6a1c428'
down_revision: Union[str, None] = 'a8d2e5f0b317'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('users', sa.Column('age_limit', sa.String(length=8), nullable=True))


def downgrade() -> None:
    op.drop_column('users', 'age_limit')
