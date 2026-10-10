"""opinions, opinion likes, title likes, users.opinions_blocked

Revision ID: c1f4a7d2e539
Revises: b9e3f6a1c428
Create Date: 2026-10-10 16:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'c1f4a7d2e539'
down_revision: Union[str, None] = 'b9e3f6a1c428'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('users', sa.Column('opinions_blocked', sa.Boolean(), server_default=sa.false(), nullable=False))
    op.create_table(
        'opinions',
        sa.Column('id', sa.Uuid(), nullable=False),
        sa.Column('user_id', sa.Uuid(), nullable=False),
        sa.Column('media_type', sa.String(length=10), nullable=False),
        sa.Column('tmdb_id', sa.Integer(), nullable=False),
        sa.Column('season_number', sa.Integer(), server_default='-1', nullable=False),
        sa.Column('episode_number', sa.Integer(), server_default='-1', nullable=False),
        sa.Column('parent_id', sa.Uuid(), nullable=True),
        sa.Column('body', sa.Text(), nullable=False),
        sa.Column('is_anonymous', sa.Boolean(), server_default=sa.false(), nullable=False),
        sa.Column('is_hidden', sa.Boolean(), server_default=sa.false(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['parent_id'], ['opinions.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_opinions_user_id', 'opinions', ['user_id'])
    op.create_index('ix_opinions_parent_id', 'opinions', ['parent_id'])
    op.create_index('ix_opinions_title', 'opinions', ['media_type', 'tmdb_id', 'season_number', 'episode_number'])
    op.create_table(
        'opinion_likes',
        sa.Column('id', sa.Uuid(), nullable=False),
        sa.Column('user_id', sa.Uuid(), nullable=False),
        sa.Column('opinion_id', sa.Uuid(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['opinion_id'], ['opinions.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('user_id', 'opinion_id', name='uq_opinion_like'),
    )
    op.create_index('ix_opinion_likes_user_id', 'opinion_likes', ['user_id'])
    op.create_index('ix_opinion_likes_opinion_id', 'opinion_likes', ['opinion_id'])
    op.create_table(
        'title_likes',
        sa.Column('id', sa.Uuid(), nullable=False),
        sa.Column('user_id', sa.Uuid(), nullable=False),
        sa.Column('media_type', sa.String(length=10), nullable=False),
        sa.Column('tmdb_id', sa.Integer(), nullable=False),
        sa.Column('season_number', sa.Integer(), server_default='-1', nullable=False),
        sa.Column('episode_number', sa.Integer(), server_default='-1', nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('user_id', 'media_type', 'tmdb_id', 'season_number', 'episode_number', name='uq_title_like'),
    )
    op.create_index('ix_title_likes_user_id', 'title_likes', ['user_id'])
    op.create_index('ix_title_likes_title', 'title_likes', ['media_type', 'tmdb_id', 'season_number', 'episode_number'])


def downgrade() -> None:
    op.drop_table('title_likes')
    op.drop_table('opinion_likes')
    op.drop_table('opinions')
    op.drop_column('users', 'opinions_blocked')
