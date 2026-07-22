import assert from 'assert';
import { hasPermission, isUserRole, ownsTenantResource } from '../lib/authorization';

assert.equal(isUserRole('brand_admin'), true);
assert.equal(isUserRole('owner'), false);
assert.equal(hasPermission('brand_admin', 'tenant:manage'), true);
assert.equal(hasPermission('brand_member', 'tenant:manage'), false);
assert.equal(hasPermission('brand_member', 'tenant:read'), true);
assert.equal(hasPermission('quality_reviewer', 'quality:review'), true);
assert.equal(hasPermission('quality_reviewer', 'tenant:read'), false);
assert.equal(hasPermission('system_admin', 'system:admin'), true);
assert.equal(ownsTenantResource(41, 41), true);
assert.equal(ownsTenantResource(41, 42), false);

console.log('RBAC and tenant-boundary tests passed.');
