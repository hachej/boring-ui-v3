import { assertStatement, databaseSpace, type DatabaseProvider, type Statement } from "../resources/database/database.js";
import { authorize, type Environment, type Grant, type Operation } from "./admission.js";

export { databaseSpace };
export const databaseGrant = (name: string, operations: readonly Operation[]): Grant => ({ space: databaseSpace(name), pattern: "*", operations });

/** Admitted operations over one app database. The Actor never holds the provider. */
export function createDatabase(provider: DatabaseProvider, environment: Environment) {
  const admit = (operation: Operation) => authorize(environment, operation, databaseSpace(provider.name), "*");
  return Object.freeze({
    environment,
    name: provider.name,
    assertAllowed(operation: Operation) { admit(operation); },
    async query(statement: Statement) {
      assertStatement(statement);
      admit("read");
      return provider.query({ sql: statement.sql, params: statement.params ?? [] });
    },
    async execute(statements: readonly Statement[], options: { expectedRevision?: string } = {}) {
      statements.forEach(assertStatement);
      const context = admit("write");
      return provider.execute(statements.map(s => ({ sql: s.sql, params: s.params ?? [] })), { context, expectedRevision: options.expectedRevision });
    }
  });
}
export type Database = ReturnType<typeof createDatabase>;
