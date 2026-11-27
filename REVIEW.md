# REVIEW.md — rules a reviewer holds every PR to

- **A brand save merges and never rebuilds** (#823): a route that writes `brand` starts from the stored brand and changes what it names; it never builds a new one from the fields it knows, or a field added later is lost by default.
