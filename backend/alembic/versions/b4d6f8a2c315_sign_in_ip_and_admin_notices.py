"""sign-in ip, admin notices and prefs

Revision ID: b4d6f8a2c315
Revises: a9c3e5b7d214
Create Date: 2026-10-15 08:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'b4d6f8a2c315'
down_revision: Union[str, None] = 'a9c3e5b7d214'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('sign_in_log', sa.Column('ip', sa.String(length=45), nullable=True))
    op.create_index(op.f('ix_sign_in_log_ip'), 'sign_in_log', ['ip'], unique=False)
    op.create_table('admin_notices',
    sa.Column('id', sa.Uuid(), nullable=False),
    sa.Column('at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('kind', sa.String(length=20), nullable=False),
    sa.Column('title', sa.String(length=200), nullable=False),
    sa.Column('body', sa.String(length=500), nullable=True),
    sa.Column('link', sa.String(length=30), nullable=True),
    sa.Column('user_id', sa.Uuid(), nullable=True),
    sa.Column('user_name', sa.String(length=100), nullable=True),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='SET NULL'),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_admin_notices_at'), 'admin_notices', ['at'], unique=False)
    op.create_index(op.f('ix_admin_notices_kind'), 'admin_notices', ['kind'], unique=False)
    op.create_index(op.f('ix_admin_notices_user_id'), 'admin_notices', ['user_id'], unique=False)
    op.create_table('admin_prefs',
    sa.Column('user_id', sa.Uuid(), nullable=False),
    sa.Column('notices_read_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('rest_until', sa.DateTime(timezone=True), nullable=True),
    sa.Column('rest_forever', sa.Boolean(), server_default=sa.false(), nullable=False),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('user_id')
    )


def downgrade() -> None:
    op.drop_table('admin_prefs')
    op.drop_index(op.f('ix_admin_notices_user_id'), table_name='admin_notices')
    op.drop_index(op.f('ix_admin_notices_kind'), table_name='admin_notices')
    op.drop_index(op.f('ix_admin_notices_at'), table_name='admin_notices')
    op.drop_table('admin_notices')
    op.drop_index(op.f('ix_sign_in_log_ip'), table_name='sign_in_log')
    op.drop_column('sign_in_log', 'ip')
