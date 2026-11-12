import { describe, expect, test } from 'vitest';
import {
  hasNoAuthorization,
  isAdminRole,
  isPlanCollaborator,
  isPlanOwner,
  isUserAdmin,
  isUserOwner,
  queryPermissions,
} from './permissions';
import type { User } from '../types/app';
import { ADMIN_ROLE } from './roles';

describe('hasNoAuthorization', () => {
  test('Should return whether or not the user has authorization', () => {
    expect(hasNoAuthorization(null)).toEqual(true);
    expect(
      hasNoAuthorization({
        activeRole: 'user',
        allowedRoles: [ADMIN_ROLE, 'user'],
        defaultRole: 'user',
        id: 'foo',
        permissibleQueries: {},
        rolePermissions: {},
        token: '',
      }),
    ).toEqual(true);

    expect(
      hasNoAuthorization({
        activeRole: 'user',
        allowedRoles: [ADMIN_ROLE, 'user'],
        defaultRole: 'user',
        id: 'foo',
        permissibleQueries: {
          constraint: true,
        },
        rolePermissions: {},
        token: '',
      }),
    ).toEqual(false);
  });
});

describe('Check roles', () => {
  test('Should return whether or not the provided role an "admin" role', () => {
    expect(isAdminRole('user')).toEqual(false);
    expect(isAdminRole('viewer')).toEqual(false);
    expect(isAdminRole('foo')).toEqual(false);
    expect(isAdminRole('admin')).toEqual(false);

    expect(isAdminRole(ADMIN_ROLE)).toEqual(true);
  });

  test('Should return whether or not the current role of the user is "admin"', () => {
    expect(
      isUserAdmin({
        activeRole: 'user',
        allowedRoles: [ADMIN_ROLE, 'user'],
        defaultRole: 'user',
        id: 'foo',
        permissibleQueries: {
          constraint: true,
        },
        rolePermissions: {},
        token: '',
      }),
    ).toEqual(false);

    expect(
      isUserAdmin({
        activeRole: ADMIN_ROLE,
        allowedRoles: [ADMIN_ROLE, 'user'],
        defaultRole: 'user',
        id: 'foo',
        permissibleQueries: {},
        rolePermissions: {},
        token: '',
      }),
    ).toEqual(true);
  });

  test('Should return whether or not the user is the owner of an asset', () => {
    expect(
      isUserOwner(
        {
          activeRole: 'user',
          allowedRoles: [ADMIN_ROLE, 'user'],
          defaultRole: 'user',
          id: 'foo',
          permissibleQueries: {
            constraint: true,
          },
          rolePermissions: {},
          token: '',
        },
        {
          owner: 'bar',
        },
      ),
    ).toEqual(false);

    expect(
      isUserOwner(
        {
          activeRole: ADMIN_ROLE,
          allowedRoles: [ADMIN_ROLE, 'user'],
          defaultRole: 'user',
          id: 'foo',
          permissibleQueries: {},
          rolePermissions: {},
          token: '',
        },
        {
          owner: 'foo',
        },
      ),
    ).toEqual(true);
  });

  test('Should return whether or not the user is the owner of a plan', () => {
    expect(
      isPlanOwner(
        {
          activeRole: 'user',
          allowedRoles: [ADMIN_ROLE, 'user'],
          defaultRole: 'user',
          id: 'foo',
          permissibleQueries: {
            constraint: true,
          },
          rolePermissions: {},
          token: '',
        },
        {
          collaborators: [],
          id: 1,
          owner: 'bar',
        },
      ),
    ).toEqual(false);

    expect(
      isPlanOwner(
        {
          activeRole: ADMIN_ROLE,
          allowedRoles: [ADMIN_ROLE, 'user'],
          defaultRole: 'user',
          id: 'foo',
          permissibleQueries: {},
          rolePermissions: {},
          token: '',
        },
        {
          collaborators: [],
          id: 1,
          owner: 'foo',
        },
      ),
    ).toEqual(true);
  });

  test('Should return whether or not the user is a collaborator of a plan', () => {
    expect(
      isPlanCollaborator(
        {
          activeRole: 'user',
          allowedRoles: [ADMIN_ROLE, 'user'],
          defaultRole: 'user',
          id: 'baz',
          permissibleQueries: {
            constraint: true,
          },
          rolePermissions: {},
          token: '',
        },
        {
          collaborators: [{ collaborator: 'foo' }],
          id: 1,
          model_id: 1,
          owner: 'bar',
        },
      ),
    ).toEqual(false);

    expect(
      isPlanCollaborator(
        {
          activeRole: ADMIN_ROLE,
          allowedRoles: [ADMIN_ROLE, 'user'],
          defaultRole: 'user',
          id: 'foo',
          permissibleQueries: {},
          rolePermissions: {},
          token: '',
        },
        {
          collaborators: [{ collaborator: 'foo' }],
          id: 1,
          model_id: 1,
          owner: 'bar',
        },
      ),
    ).toEqual(true);
  });
});

describe('importing a source revision', () => {
  const as = (activeRole: string, id: string, permissibleQueries: Record<string, true> = {}): User => ({
    activeRole,
    allowedRoles: [ADMIN_ROLE, 'user'],
    defaultRole: activeRole,
    id,
    permissibleQueries,
    rolePermissions: {},
    token: '',
  });
  const insert: Record<string, true> = { insert_source_one: true, insert_source_revision_one: true };

  test("admins can import into any source, ownerless or someone else's", () => {
    const admin = as(ADMIN_ROLE, 'admin');
    expect(queryPermissions.CREATE_SOURCE_REVISION(admin, { owner: null })).toEqual(true);
    expect(queryPermissions.CREATE_SOURCE_REVISION(admin, { owner: 'someone' })).toEqual(true);
  });

  test('anyone else can import into their own sources only, as Hasura checks', () => {
    const user = as('user', 'me', insert);
    expect(queryPermissions.CREATE_SOURCE_REVISION(user, { owner: 'me' })).toEqual(true);
    expect(queryPermissions.CREATE_SOURCE_REVISION(user, { owner: 'someone' })).toEqual(false);
    expect(queryPermissions.CREATE_SOURCE_REVISION(user, { owner: null })).toEqual(false);
    expect(queryPermissions.CREATE_SOURCE_REVISION(as('user', 'me'), { owner: 'me' })).toEqual(false);
  });

  test('a new source needs both inserts', () => {
    expect(queryPermissions.CREATE_SOURCE_REVISION(as('user', 'me', insert))).toEqual(true);
    expect(queryPermissions.CREATE_SOURCE_REVISION(as('user', 'me', { insert_source_one: true }))).toEqual(false);
  });
});

describe('using a source in a plan', () => {
  const as = (activeRole: string, id: string, permissibleQueries: Record<string, true> = {}): User => ({
    activeRole,
    allowedRoles: [ADMIN_ROLE, 'user'],
    defaultRole: activeRole,
    id,
    permissibleQueries,
    rolePermissions: {},
    token: '',
  });
  const plan = { collaborators: [{ collaborator: 'friend' }], id: 1, model_id: 1, owner: 'me' };
  const insert: Record<string, true> = { insert_plan_source_one: true };

  test("admins can add to any plan; anyone else only to a plan they own, as Hasura's check says", () => {
    expect(queryPermissions.CREATE_PLAN_SOURCE(as(ADMIN_ROLE, 'admin'), plan)).toEqual(true);
    expect(queryPermissions.CREATE_PLAN_SOURCE(as('user', 'me', insert), plan)).toEqual(true);
    expect(queryPermissions.CREATE_PLAN_SOURCE(as('user', 'friend', insert), plan)).toEqual(false);
    expect(queryPermissions.CREATE_PLAN_SOURCE(as('user', 'me'), plan)).toEqual(false);
  });
});
