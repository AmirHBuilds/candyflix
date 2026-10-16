"""add error logs

Revision ID: a9c3e5b7d214
Revises: d8f2a6b4c901
Create Date: 2026-10-15 01:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'a9c3e5b7d214'
down_revision: Union[str, None] = 'd8f2a6b4c901'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table('error_logs',
    sa.Column('id', sa.Uuid(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('last_seen', sa.DateTime(timezone=True), nullable=False),
    sa.Column('count', sa.Integer(), server_default='1', nullable=False),
    sa.Column('source', sa.String(length=20), nullable=False),
    sa.Column('level', sa.String(length=10), nullable=False),
    sa.Column('title', sa.String(length=300), nullable=False),
    sa.Column('detail', sa.Text(), nullable=True),
    sa.Column('where', sa.String(length=300), nullable=True),
    sa.Column('user_name', sa.String(length=100), nullable=True),
    sa.Column('fingerprint', sa.String(length=40), nullable=False),
    sa.Column('handled', sa.Boolean(), server_default=sa.false(), nullable=False),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_error_logs_created_at'), 'error_logs', ['created_at'], unique=False)
    op.create_index(op.f('ix_error_logs_source'), 'error_logs', ['source'], unique=False)
    op.create_index(op.f('ix_error_logs_fingerprint'), 'error_logs', ['fingerprint'], unique=False)


def downgrade() -> None:
    op.drop_index(op.f('ix_error_logs_fingerprint'), table_name='error_logs')
    op.drop_index(op.f('ix_error_logs_source'), table_name='error_logs')
    op.drop_index(op.f('ix_error_logs_created_at'), table_name='error_logs')
    op.drop_table('error_logs')
