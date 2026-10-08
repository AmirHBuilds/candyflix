"""add ai_searches

Revision ID: e6b0c3d8f125
Revises: d5a9b2c7e014
Create Date: 2026-10-08 20:30:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'e6b0c3d8f125'
down_revision: Union[str, None] = 'd5a9b2c7e014'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'ai_searches',
        sa.Column('id', sa.Uuid(), primary_key=True),
        sa.Column('user_id', sa.Uuid(), sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=False),
        sa.Column('prompt', sa.String(length=400), nullable=False),
        sa.Column('results', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('used_history', sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index('ix_ai_searches_user_id', 'ai_searches', ['user_id'])
    op.create_index('ix_ai_searches_created_at', 'ai_searches', ['created_at'])


def downgrade() -> None:
    op.drop_index('ix_ai_searches_created_at', table_name='ai_searches')
    op.drop_index('ix_ai_searches_user_id', table_name='ai_searches')
    op.drop_table('ai_searches')
