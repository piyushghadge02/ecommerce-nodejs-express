'use strict';

/** PostgreSQL repository: users. Mirrors repositories/users_repo.py. */

async function listUsers(client) {
  const { rows } = await client.query('SELECT id, name, email FROM users ORDER BY id');
  return rows;
}

async function getUser(client, userId) {
  const { rows } = await client.query('SELECT id, name, email FROM users WHERE id = $1', [userId]);
  return rows[0] || null;
}

module.exports = { listUsers, getUser };
