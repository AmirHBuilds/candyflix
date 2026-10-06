"""add announcements, targets and acknowledgements

Revision ID: b7d2f4a91c33
Revises: a1c3e5f70912
Create Date: 2026-10-05 18:40:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'b7d2f4a91c33'
down_revision: Union[str, None] = 'a1c3e5f70912'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table('announcements',
    sa.Column('id', sa.Uuid(), nullable=False),
    sa.Column('title', sa.String(length=120), nullable=False),
    sa.Column('body', sa.Text(), nullable=False),
    sa.Column('audience', sa.String(length=10), nullable=False),
    sa.Column('created_by', sa.Uuid(), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('expires_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('is_active', sa.Boolean(), server_default=sa.text('true'), nullable=False),
    sa.ForeignKeyConstraint(['created_by'], ['users.id'], ondelete='SET NULL'),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_table('announcement_targets',
    sa.Column('announcement_id', sa.Uuid(), nullable=False),
    sa.Column('user_id', sa.Uuid(), nullable=False),
    sa.ForeignKeyConstraint(['announcement_id'], ['announcements.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('announcement_id', 'user_id')
    )
    op.create_index(op.f('ix_announcement_targets_user_id'), 'announcement_targets', ['user_id'], unique=False)
    op.create_table('announcement_acks',
    sa.Column('announcement_id', sa.Uuid(), nullable=False),
    sa.Column('user_id', sa.Uuid(), nullable=False),
    sa.Column('acked_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['announcement_id'], ['announcements.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('announcement_id', 'user_id')
    )
    op.create_index(op.f('ix_announcement_acks_user_id'), 'announcement_acks', ['user_id'], unique=False)


def downgrade() -> None:
    op.drop_index(op.f('ix_announcement_acks_user_id'), table_name='announcement_acks')
    op.drop_table('announcement_acks')
    op.drop_index(op.f('ix_announcement_targets_user_id'), table_name='announcement_targets')
    op.drop_table('announcement_targets')
    op.drop_table('announcements')
