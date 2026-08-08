# SeaTunnel offline artifact license boundary

The release bundle must include the upstream license and notice files for the
SeaTunnel distribution and every connector/driver actually copied into the
image. The build manifest records source URL, version and SHA-256; it does not
grant redistribution rights.

The JDBC driver profile is a controlled build input. The release operator must
keep the applicable vendor terms and approval evidence with the release record:

- PostgreSQL JDBC: https://jdbc.postgresql.org/license/
- MySQL Connector/J: https://www.mysql.com/about/legal/licensing/oem/
- Microsoft JDBC Driver for SQL Server: https://github.com/microsoft/mssql-jdbc/blob/main/README.md
- Oracle JDBC: https://www.oracle.com/downloads/licenses/standard-license.html

An Oracle-enabled package is not a valid production artifact until the
customer-supplied JAR and its redistribution approval are recorded.
