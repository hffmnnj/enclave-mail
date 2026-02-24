export interface SrpRegistrationResult {
  salt: string;
  verifier: string;
}

export interface SrpClientEphemeral {
  public: string;
  secret: string;
}

export interface SrpServerEphemeral {
  public: string;
  secret: string;
}

export interface SrpClientSession {
  key: string;
  proof: string;
}

export interface SrpServerSession {
  key: string;
  proof: string;
}
