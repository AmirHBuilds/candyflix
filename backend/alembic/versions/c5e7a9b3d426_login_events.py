"""login events

Revision ID: c5e7a9b3d426
Revises: b4d6f8a2c315
Create Date: 2026-10-15 14:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'c5e7a9b3d426'
down_revision: Union[str, None] = 'b4d6f8a2c315'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table('login_events',
    sa.Column('id', sa.Uuid(), nullable=False),
    sa.Column('at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('kind', sa.String(length=12), nullable=False),
    sa.Column('username', sa.String(length=100), nullable=True),
    sa.Column('ip', sa.String(length=45), nullable=True),
    sa.Column('detail', sa.String(length=200), nullable=True),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_login_events_at'), 'login_events', ['at'], unique=False)
    op.create_index(op.f('ix_login_events_kind'), 'login_events', ['kind'], unique=False)
    op.create_index(op.f('ix_login_events_ip'), 'login_events', ['ip'], unique=False)


def downgrade() -> None:
    op.drop_index(op.f('ix_login_events_ip'), table_name='login_events')
    op.drop_index(op.f('ix_login_events_kind'), table_name='login_events')
    op.drop_index(op.f('ix_login_events_at'), table_name='login_events')
    op.drop_table('login_events')
