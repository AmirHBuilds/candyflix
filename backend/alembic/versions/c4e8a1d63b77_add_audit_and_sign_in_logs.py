"""add audit log and sign-in log

Revision ID: c4e8a1d63b77
Revises: b7d2f4a91c33
Create Date: 2026-10-05 23:50:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'c4e8a1d63b77'
down_revision: Union[str, None] = 'b7d2f4a91c33'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table('audit_log',
    sa.Column('id', sa.Uuid(), nullable=False),
    sa.Column('at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('actor_id', sa.Uuid(), nullable=True),
    sa.Column('actor_name', sa.String(length=100), nullable=False),
    sa.Column('action', sa.String(length=40), nullable=False),
    sa.Column('target_user_id', sa.Uuid(), nullable=True),
    sa.Column('target_name', sa.String(length=200), nullable=True),
    sa.Column('detail', sa.String(length=300), nullable=True),
    sa.ForeignKeyConstraint(['actor_id'], ['users.id'], ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['target_user_id'], ['users.id'], ondelete='SET NULL'),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_audit_log_at'), 'audit_log', ['at'], unique=False)
    op.create_index(op.f('ix_audit_log_action'), 'audit_log', ['action'], unique=False)
    op.create_index(op.f('ix_audit_log_target_user_id'), 'audit_log', ['target_user_id'], unique=False)
    op.create_table('sign_in_log',
    sa.Column('id', sa.Uuid(), nullable=False),
    sa.Column('at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('user_id', sa.Uuid(), nullable=False),
    sa.Column('user_agent', sa.String(length=300), nullable=True),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_sign_in_log_at'), 'sign_in_log', ['at'], unique=False)
    op.create_index(op.f('ix_sign_in_log_user_id'), 'sign_in_log', ['user_id'], unique=False)


def downgrade() -> None:
    op.drop_index(op.f('ix_sign_in_log_user_id'), table_name='sign_in_log')
    op.drop_index(op.f('ix_sign_in_log_at'), table_name='sign_in_log')
    op.drop_table('sign_in_log')
    op.drop_index(op.f('ix_audit_log_target_user_id'), table_name='audit_log')
    op.drop_index(op.f('ix_audit_log_action'), table_name='audit_log')
    op.drop_index(op.f('ix_audit_log_at'), table_name='audit_log')
    op.drop_table('audit_log')
