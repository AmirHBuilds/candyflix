"""devices

Revision ID: d6f8b0c4e537
Revises: c5e7a9b3d426
Create Date: 2026-10-16 04:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'd6f8b0c4e537'
down_revision: Union[str, None] = 'c5e7a9b3d426'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table('devices',
    sa.Column('id', sa.Uuid(), nullable=False),
    sa.Column('user_id', sa.Uuid(), nullable=False),
    sa.Column('device_id', sa.String(length=64), nullable=False),
    sa.Column('label', sa.String(length=100), nullable=False),
    sa.Column('user_agent', sa.String(length=300), nullable=True),
    sa.Column('first_ip', sa.String(length=45), nullable=True),
    sa.Column('last_ip', sa.String(length=45), nullable=True),
    sa.Column('country', sa.String(length=3), nullable=True),
    sa.Column('first_seen', sa.DateTime(timezone=True), nullable=False),
    sa.Column('last_seen', sa.DateTime(timezone=True), nullable=False),
    sa.Column('last_login_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('sign_ins', sa.Integer(), nullable=False),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('user_id', 'device_id', name='uq_devices_user_device')
    )
    op.create_index(op.f('ix_devices_user_id'), 'devices', ['user_id'], unique=False)
    op.create_index(op.f('ix_devices_last_seen'), 'devices', ['last_seen'], unique=False)


def downgrade() -> None:
    op.drop_index(op.f('ix_devices_last_seen'), table_name='devices')
    op.drop_index(op.f('ix_devices_user_id'), table_name='devices')
    op.drop_table('devices')
