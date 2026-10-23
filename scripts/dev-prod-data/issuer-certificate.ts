import { connect } from "node:tls";

/** The certificate the issuer presents, as PEM. Trust on first use: loopback issuers only. */
export function readPeerCertificate(issuer: URL): Promise<string> {
  return new Promise((done, fail) => {
    const socket = connect({
      host: issuer.hostname,
      port: Number(issuer.port || 443),
      servername: issuer.hostname === "localhost" ? "localhost" : undefined,
      rejectUnauthorized: false,
    });
    socket.setTimeout(5000, () => socket.destroy(new Error("timed out")));
    socket.once("secureConnect", () => {
      const certificate = socket.getPeerX509Certificate();
      socket.end();
      if (certificate) done(certificate.toString());
      else fail(new Error("no certificate"));
    });
    socket.once("error", fail);
  });
}
