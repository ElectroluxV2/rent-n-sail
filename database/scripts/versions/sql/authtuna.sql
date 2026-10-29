create table authtuna.encryption_keys
(
    id             varchar(64)      not null primary key,
    key_ciphertext text             not null,
    created_at     double precision not null,
    deleted_at     double precision
);

alter table authtuna.encryption_keys
    owner to postgres;

create table authtuna.roles
(
    id          serial primary key,
    name        varchar(80) not null
        unique,
    description varchar(255),
    system      boolean     not null,
    level       integer
);

alter table authtuna.roles
    owner to postgres;

create table authtuna.permissions
(
    id          serial
        primary key,
    name        varchar(80) not null
        unique,
    description varchar(255),
    system      boolean     not null
);

alter table authtuna.permissions
    owner to postgres;

create table authtuna.deleted_users
(
    user_id         varchar(64)      not null
        primary key,
    email           varchar(255)     not null,
    data            jsonb,
    data_encrypted  bytea,
    initiated_at    double precision not null,
    cleanup_counter integer          not null
);

alter table authtuna.deleted_users
    owner to postgres;

create table authtuna.role_assign_permissions
(
    assigner_role_id   integer not null
        references authtuna.roles,
    assignable_role_id integer not null
        references authtuna.roles,
    primary key (assigner_role_id, assignable_role_id)
);

alter table authtuna.role_assign_permissions
    owner to postgres;

create table authtuna.role_grant_permissions
(
    granter_role_id         integer not null
        references authtuna.roles,
    grantable_permission_id integer not null
        references authtuna.permissions,
    primary key (granter_role_id, grantable_permission_id)
);

alter table authtuna.role_grant_permissions
    owner to postgres;

create table authtuna.users
(
    id                      varchar(64)      not null
        primary key,
    username                citext           not null,
    email                   citext           not null,
    email_encrypted         bytea,
    email_key_id            varchar(64)
        references authtuna.encryption_keys,
    is_active               boolean          not null,
    password_hash           varchar(256),
    email_verified          boolean          not null,
    requires_password_reset boolean          not null,
    mfa_enabled             boolean          not null,
    created_at              double precision not null,
    last_login              double precision not null
);

alter table authtuna.users
    owner to postgres;

create unique index ix_users_username
    on authtuna.users (username);

create unique index ix_users_email
    on authtuna.users (email);

create index ix_users_id
    on authtuna.users (id);

create table authtuna.user_roles
(
    user_id     varchar(64)      not null
        references authtuna.users,
    role_id     integer          not null
        references authtuna.roles,
    scope       varchar(255)     not null,
    given_by_id varchar(64)      not null,
    given_at    double precision not null,
    primary key (user_id, role_id, scope)
);

alter table authtuna.user_roles
    owner to postgres;

create table authtuna.role_permissions
(
    role_id       integer          not null
        references authtuna.roles,
    permission_id integer          not null
        references authtuna.permissions,
    added_by_id   varchar(64)
        references authtuna.users,
    added_at      double precision not null,
    primary key (role_id, permission_id)
);

alter table authtuna.role_permissions
    owner to postgres;

create table authtuna.sessions
(
    session_id              varchar(32)      not null
        primary key,
    user_id                 varchar(64)      not null
        references authtuna.users,
    region                  varchar(255),
    device                  varchar(255),
    active                  boolean          not null,
    ctime                   double precision not null,
    mtime                   double precision not null,
    etime                   double precision not null,
    e_abs_time              double precision not null,
    create_ip               varchar(45),
    last_ip                 varchar(45),
    random_string           varchar(255)     not null,
    previous_random_strings jsonb            not null
);

alter table authtuna.sessions
    owner to postgres;

create index ix_sessions_user_id
    on authtuna.sessions (user_id);

create table authtuna.tokens
(
    id         varchar(64)      not null
        primary key,
    purpose    varchar(200)     not null,
    user_id    varchar(64)      not null
        references authtuna.users,
    ctime      double precision not null,
    etime      double precision not null,
    used       boolean          not null,
    new_gen_id varchar(64)
        references authtuna.tokens
);

alter table authtuna.tokens
    owner to postgres;

create index ix_tokens_user_id
    on authtuna.tokens (user_id);

create index ix_tokens_purpose
    on authtuna.tokens (purpose);

create table authtuna.social_accounts
(
    id                       serial
        primary key,
    user_id                  varchar(64)      not null
        references authtuna.users,
    extra_data               jsonb,
    created_at               double precision not null,
    last_used_at             double precision not null,
    provider                 varchar(50)      not null,
    provider_user_id         varchar(255)     not null,
    token_type               varchar(40)      not null,
    access_token             varchar(1200)    not null,
    refresh_token            varchar(1200),
    extra_data_encrypted     bytea,
    expires_at               integer,
    client_id                varchar(48),
    client_secret            varchar(120),
    client_id_issued_at      integer          not null,
    client_secret_expires_at integer          not null,
    client_metadata          text
);

alter table authtuna.social_accounts
    owner to postgres;

create index ix_social_accounts_user_id
    on authtuna.social_accounts (user_id);

create index ix_social_accounts_client_id
    on authtuna.social_accounts (client_id);

create index ix_social_accounts_provider
    on authtuna.social_accounts (provider);

create index ix_social_accounts_provider_user_id
    on authtuna.social_accounts (provider_user_id);

create table authtuna.mfa_methods
(
    id          serial
        primary key,
    user_id     varchar(64) not null
        references authtuna.users,
    method_type varchar(20) not null,
    secret      varchar(255),
    is_verified boolean     not null
);

alter table authtuna.mfa_methods
    owner to postgres;

create index ix_mfa_methods_user_id
    on authtuna.mfa_methods (user_id);

create table authtuna.mfa_recovery_codes
(
    id          serial
        primary key,
    user_id     varchar(64)  not null
        references authtuna.users,
    hashed_code varchar(256) not null
        unique,
    is_used     boolean      not null,
    actived_at  double precision,
    active      boolean      not null
);

alter table authtuna.mfa_recovery_codes
    owner to postgres;

create index ix_mfa_recovery_codes_user_id
    on authtuna.mfa_recovery_codes (user_id);

create table authtuna.passkey_credentials
(
    id                 bytea            not null
        primary key,
    user_id            varchar(64)      not null
        references authtuna.users
            on delete cascade,
    nickname           varchar(100)     not null,
    public_key         bytea            not null,
    sign_count         integer          not null,
    aaguid             bytea,
    is_discoverable    boolean          not null,
    is_backup_eligible boolean          not null,
    is_backed_up       boolean          not null,
    transports         jsonb,
    created_at         double precision not null,
    last_used_at       double precision not null
);

alter table authtuna.passkey_credentials
    owner to postgres;

create index ix_passkey_credentials_user_id
    on authtuna.passkey_credentials (user_id);

create table authtuna.audit_events
(
    id                   serial
        primary key,
    user_id              varchar(64)
        references authtuna.users,
    event_type           varchar(100)     not null,
    timestamp            double precision not null,
    ip_address           varchar(45),
    ip_address_encrypted bytea,
    ip_address_hash      varchar(64),
    details              jsonb
);

alter table authtuna.audit_events
    owner to postgres;

create index ix_audit_events_event_type
    on authtuna.audit_events (event_type);

create index ix_audit_events_ip_address_hash
    on authtuna.audit_events (ip_address_hash);

create index ix_audit_events_user_id
    on authtuna.audit_events (user_id);

create table authtuna.organization
(
    id         varchar(64)      not null
        primary key,
    name       varchar(100)     not null
        unique,
    owner_id   varchar(64)      not null
        references authtuna.users,
    created_at double precision not null
);

alter table authtuna.organization
    owner to postgres;

create table authtuna.api_keys
(
    id           varchar(64)      not null
        primary key,
    hashed_key   varchar(256)     not null
        unique,
    user_id      varchar(64)      not null
        references authtuna.users
            on delete cascade,
    key_type     varchar(20)      not null,
    name         varchar(100),
    created_at   double precision not null,
    last_used_at double precision,
    expires_at   double precision
);

alter table authtuna.api_keys
    owner to postgres;

create index ix_api_keys_user_id
    on authtuna.api_keys (user_id);

create index ix_api_keys_id
    on authtuna.api_keys (id);

create table authtuna.organization_members
(
    user_id         varchar(64)      not null
        references authtuna.users,
    organization_id varchar(64)      not null
        references authtuna.organization,
    joined_at       double precision not null,
    primary key (user_id, organization_id)
);

alter table authtuna.organization_members
    owner to postgres;

create table authtuna.api_key_scopes
(
    api_key_id varchar(64)  not null
        references authtuna.api_keys
            on delete cascade,
    user_id    varchar(64)  not null,
    role_id    integer      not null,
    scope      varchar(255) not null,
    primary key (api_key_id, user_id, role_id, scope),
    foreign key (user_id, role_id, scope) references authtuna.user_roles
        on delete cascade
);

alter table authtuna.api_key_scopes
    owner to postgres;

create table authtuna.team
(
    id              varchar(64)      not null
        primary key,
    name            varchar(100)     not null,
    organization_id varchar(64)      not null
        references authtuna.organization,
    created_at      double precision not null
);

alter table authtuna.team
    owner to postgres;

create table authtuna.team_members
(
    user_id   varchar(64)      not null
        references authtuna.users,
    team_id   varchar(64)      not null
        references authtuna.team,
    joined_at double precision not null,
    primary key (user_id, team_id)
);

alter table authtuna.team_members
    owner to postgres;
