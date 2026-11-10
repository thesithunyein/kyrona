use near_sdk::json_types::U128;
use near_sdk::{env, near, require, AccountId, Gas, NearToken, Promise, PromiseError};

/// Requests that may wait for the owner at once. A compromised agent can fill the queue, but not
/// the contract's storage, and the owner can reject or lock at any time.
pub const MAX_WAITING: usize = 20;
/// Longest note an agent can attach to a request.
pub const MAX_NOTE: usize = 140;
const CALLBACK_GAS: Gas = Gas::from_tgas(5);
const DAY_MS: u64 = 86_400_000;

/// Spending rules that live on the account.
/// A key that can only call `pay` and `request` cannot transfer NEAR, add a key, deploy code,
/// change the rules, or approve its own requests.
/// `pay` refuses an unknown account, a locked desk, or an amount over the cap.
/// `request` asks the owner instead: nothing moves until the owner calls `approve`.
#[near(contract_state)]
pub struct Kyrona {
    owner: AccountId,
    max_per_payment: u128,
    daily_cap: u128,
    open: bool,
    spent: u128,
    day: u64,
    allowed: Vec<AccountId>,
    waiting: Vec<Waiting>,
    next_id: u64,
}

/// A payment the agent asked for that the rules do not allow on their own.
#[near(serializers = [borsh])]
#[derive(Clone)]
pub struct Waiting {
    id: u64,
    to: AccountId,
    amount: u128,
    note: String,
    at_ms: u64,
}

/// The state the first version stored. `migrate` reads it once.
#[near(serializers = [borsh])]
pub struct KyronaV1 {
    owner: AccountId,
    max_per_payment: u128,
    daily_cap: u128,
    open: bool,
    spent: u128,
    day: u64,
    allowed: Vec<AccountId>,
}

impl Default for Kyrona {
    fn default() -> Self {
        Self {
            owner: "owner.near".parse().unwrap(),
            max_per_payment: 0,
            daily_cap: 0,
            open: false,
            spent: 0,
            day: 0,
            allowed: Vec::new(),
            waiting: Vec::new(),
            next_id: 0,
        }
    }
}

#[near]
impl Kyrona {
    #[init]
    pub fn new(max_per_payment: U128, daily_cap: U128, open: bool, allowed: Vec<AccountId>) -> Self {
        Self {
            owner: env::predecessor_account_id(),
            max_per_payment: max_per_payment.0,
            daily_cap: daily_cap.0,
            open,
            spent: 0,
            day: 0,
            allowed,
            waiting: Vec::new(),
            next_id: 0,
        }
    }

    /// Upgrades a rules account that runs the first version, keeping its owner, list, caps,
    /// lock and today's spend. Only the rules account itself can call it, in the same
    /// transaction that deploys the new code. (near-sdk ignores `#[private]` on init methods,
    /// so the check is written out.)
    #[init(ignore_state)]
    pub fn migrate() -> Self {
        require!(
            env::predecessor_account_id() == env::current_account_id(),
            "Only the rules account can migrate"
        );
        let old: KyronaV1 = env::state_read().expect("No rules to migrate");
        Self {
            owner: old.owner,
            max_per_payment: old.max_per_payment,
            daily_cap: old.daily_cap,
            open: old.open,
            spent: old.spent,
            day: old.day,
            allowed: old.allowed,
            waiting: Vec::new(),
            next_id: 0,
        }
    }

    pub fn set_rules(&mut self, max_per_payment: U128, daily_cap: U128, open: bool, allowed: Vec<AccountId>) {
        self.only_owner();
        self.max_per_payment = max_per_payment.0;
        self.daily_cap = daily_cap.0;
        self.open = open;
        self.allowed = allowed;
    }

    pub fn pay(&mut self, to: AccountId, amount: U128) -> Promise {
        self.only_owner();
        require!(self.open, "Spending is locked");
        require!(self.allowed.iter().any(|account| account == &to), "Not on the list");
        let amount = amount.0;
        require!(amount > 0, "Amount is empty");
        require!(amount <= self.max_per_payment, "Over the per-payment cap");
        self.roll_day();
        require!(self.spent + amount <= self.daily_cap, "Over the daily cap");
        self.send(to, amount)
    }

    /// Asks the owner for a payment the rules do not allow on their own: a new account, or an
    /// amount over a cap. Nothing moves. Returns the request's id.
    pub fn request(&mut self, to: AccountId, amount: U128, note: Option<String>) -> u64 {
        self.only_owner();
        require!(amount.0 > 0, "Amount is empty");
        require!(self.waiting.len() < MAX_WAITING, "Too many requests waiting");
        let note = note.unwrap_or_default();
        require!(note.len() <= MAX_NOTE, "Note is too long");
        let id = self.next_id;
        self.next_id += 1;
        env::log_str(&format!("Request {id}: {} yoctoNEAR to {to} waits for the owner", amount.0));
        self.waiting.push(Waiting { id, to, amount: amount.0, note, at_ms: env::block_timestamp_ms() });
        id
    }

    /// Pays a waiting request. The owner's yes overrides the list and the caps, not the lock.
    /// The payment still counts toward today's spend.
    pub fn approve(&mut self, id: u64) -> Promise {
        self.only_owner();
        require!(self.open, "Spending is locked");
        let request = self.take(id);
        self.roll_day();
        env::log_str(&format!("Request {id} approved"));
        self.send(request.to, request.amount)
    }

    /// Drops a waiting request. Nothing moves.
    pub fn reject(&mut self, id: u64) {
        self.only_owner();
        self.take(id);
        env::log_str(&format!("Request {id} rejected"));
    }

    /// Runs after each transfer. If the transfer failed, the NEAR came back, so it no longer
    /// counts toward today's spend.
    #[private]
    pub fn on_transfer(&mut self, amount: U128, day: u64, #[callback_result] result: Result<(), PromiseError>) -> bool {
        if result.is_ok() {
            return true;
        }
        if self.day == day {
            self.spent = self.spent.saturating_sub(amount.0);
        }
        env::log_str(&format!("Transfer of {} yoctoNEAR failed and was not counted", amount.0));
        false
    }

    pub fn rules(&self) -> RuleView {
        RuleView {
            owner: self.owner.clone(),
            max_per_payment: self.max_per_payment.into(),
            daily_cap: self.daily_cap.into(),
            open: self.open,
            spent: self.spent.into(),
            allowed: self.allowed.clone(),
            waiting: self.waiting.len() as u32,
        }
    }

    pub fn requests(&self) -> Vec<RequestView> {
        self.waiting
            .iter()
            .map(|w| RequestView {
                id: w.id,
                to: w.to.clone(),
                amount: w.amount.into(),
                note: w.note.clone(),
                at_ms: w.at_ms,
            })
            .collect()
    }
}

impl Kyrona {
    fn only_owner(&self) {
        require!(env::predecessor_account_id() == self.owner, "Only the owner");
    }

    fn roll_day(&mut self) {
        let day = env::block_timestamp_ms() / DAY_MS;
        if day != self.day {
            self.day = day;
            self.spent = 0;
        }
    }

    fn take(&mut self, id: u64) -> Waiting {
        let index = self.waiting.iter().position(|w| w.id == id);
        require!(index.is_some(), "No such request");
        self.waiting.remove(index.unwrap())
    }

    fn send(&mut self, to: AccountId, amount: u128) -> Promise {
        self.spent += amount;
        Promise::new(to)
            .transfer(NearToken::from_yoctonear(amount))
            .then(Self::ext(env::current_account_id()).with_static_gas(CALLBACK_GAS).on_transfer(amount.into(), self.day))
    }
}

#[near(serializers = [json])]
pub struct RuleView {
    pub owner: AccountId,
    pub max_per_payment: U128,
    pub daily_cap: U128,
    pub open: bool,
    pub spent: U128,
    pub allowed: Vec<AccountId>,
    pub waiting: u32,
}

#[near(serializers = [json])]
pub struct RequestView {
    pub id: u64,
    pub to: AccountId,
    pub amount: U128,
    pub note: String,
    pub at_ms: u64,
}

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::test_utils::VMContextBuilder;
    use near_sdk::{testing_env, NearToken};

    const NEAR: u128 = 1_000_000_000_000_000_000_000_000;
    const DAY_MS: u64 = 86_400_000;
    const START_MS: u64 = 1_700_000_000_000;
    const OWNER: &str = "sithunyein.near";
    const PAYEE: &str = "kyawminthat.near";
    const VENDOR: &str = "vendor.sithunyein.near";

    fn account(name: &str) -> AccountId {
        name.parse().unwrap()
    }

    fn context(predecessor: &str, ts_ms: u64) {
        let context = VMContextBuilder::new()
            .predecessor_account_id(account(predecessor))
            .block_timestamp(ts_ms * 1_000_000)
            .account_balance(NearToken::from_near(1_000))
            .build();
        testing_env!(context);
    }

    fn setup() -> Kyrona {
        context(OWNER, START_MS);
        Kyrona::new(
            U128(20 * NEAR),
            U128(50 * NEAR),
            true,
            vec![account(PAYEE), account(VENDOR)],
        )
    }

    #[test]
    fn new_records_the_owner_and_the_rules() {
        let contract = setup();
        let rules = contract.rules();
        assert_eq!(rules.owner, account(OWNER));
        assert_eq!(rules.max_per_payment.0, 20 * NEAR);
        assert_eq!(rules.daily_cap.0, 50 * NEAR);
        assert!(rules.open);
        assert_eq!(rules.spent.0, 0);
        assert_eq!(rules.allowed, vec![account(PAYEE), account(VENDOR)]);
    }

    #[test]
    fn owner_can_replace_the_rules() {
        let mut contract = setup();
        contract.set_rules(U128(NEAR), U128(2 * NEAR), false, vec![account(PAYEE)]);
        let rules = contract.rules();
        assert_eq!(rules.max_per_payment.0, NEAR);
        assert_eq!(rules.daily_cap.0, 2 * NEAR);
        assert!(!rules.open);
        assert_eq!(rules.allowed, vec![account(PAYEE)]);
    }

    #[test]
    #[should_panic(expected = "Only the owner")]
    fn non_owner_cannot_replace_the_rules() {
        let mut contract = setup();
        context("attacker.near", START_MS);
        contract.set_rules(U128(NEAR), U128(NEAR), true, vec![account(PAYEE)]);
    }

    #[test]
    fn pay_records_the_spend() {
        let mut contract = setup();
        contract.pay(account(PAYEE), U128(NEAR));
        assert_eq!(contract.rules().spent.0, NEAR);
    }

    #[test]
    fn pay_accumulates_within_the_day() {
        let mut contract = setup();
        contract.pay(account(PAYEE), U128(NEAR));
        contract.pay(account(VENDOR), U128(2 * NEAR));
        assert_eq!(contract.rules().spent.0, 3 * NEAR);
    }

    #[test]
    fn pay_resets_the_spend_on_a_new_day() {
        let mut contract = setup();
        contract.pay(account(PAYEE), U128(20 * NEAR));
        contract.pay(account(VENDOR), U128(20 * NEAR));
        assert_eq!(contract.rules().spent.0, 40 * NEAR);

        context(OWNER, START_MS + DAY_MS);
        contract.pay(account(PAYEE), U128(NEAR));
        assert_eq!(contract.rules().spent.0, NEAR);
    }

    #[test]
    #[should_panic(expected = "Only the owner")]
    fn non_owner_cannot_pay() {
        let mut contract = setup();
        context("attacker.near", START_MS);
        contract.pay(account(PAYEE), U128(NEAR));
    }

    #[test]
    #[should_panic(expected = "Spending is locked")]
    fn pay_stops_when_the_desk_is_locked() {
        let mut contract = setup();
        contract.set_rules(U128(20 * NEAR), U128(50 * NEAR), false, vec![account(PAYEE)]);
        contract.pay(account(PAYEE), U128(NEAR));
    }

    #[test]
    #[should_panic(expected = "Not on the list")]
    fn pay_refuses_an_unknown_account() {
        let mut contract = setup();
        contract.pay(account("outside.near"), U128(NEAR));
    }

    #[test]
    #[should_panic(expected = "Amount is empty")]
    fn pay_refuses_an_empty_amount() {
        let mut contract = setup();
        contract.pay(account(PAYEE), U128(0));
    }

    #[test]
    #[should_panic(expected = "Over the per-payment cap")]
    fn pay_refuses_more_than_the_per_payment_cap() {
        let mut contract = setup();
        contract.pay(account(PAYEE), U128(20 * NEAR + 1));
    }

    #[test]
    #[should_panic(expected = "Over the daily cap")]
    fn pay_refuses_more_than_the_daily_cap() {
        let mut contract = setup();
        contract.pay(account(PAYEE), U128(20 * NEAR));
        contract.pay(account(VENDOR), U128(20 * NEAR));
        contract.pay(account(PAYEE), U128(20 * NEAR));
    }

    const RULES: &str = "rules.sithunyein.near";

    // A call the contract makes to itself, such as a callback or `migrate`.
    fn context_self(ts_ms: u64) {
        let context = VMContextBuilder::new()
            .current_account_id(account(RULES))
            .predecessor_account_id(account(RULES))
            .block_timestamp(ts_ms * 1_000_000)
            .account_balance(NearToken::from_near(1_000))
            .build();
        testing_env!(context);
    }

    #[test]
    fn request_waits_and_moves_nothing() {
        let mut contract = setup();
        let id = contract.request(account("outside.near"), U128(NEAR), Some("invoice 42".into()));
        assert_eq!(id, 0);
        let waiting = contract.requests();
        assert_eq!(waiting.len(), 1);
        assert_eq!(waiting[0].to, account("outside.near"));
        assert_eq!(waiting[0].amount.0, NEAR);
        assert_eq!(waiting[0].note, "invoice 42");
        assert_eq!(contract.rules().spent.0, 0);
        assert_eq!(contract.rules().waiting, 1);
    }

    #[test]
    fn request_ids_keep_counting() {
        let mut contract = setup();
        assert_eq!(contract.request(account("a.near"), U128(1), None), 0);
        assert_eq!(contract.request(account("b.near"), U128(1), None), 1);
        contract.reject(0);
        assert_eq!(contract.request(account("c.near"), U128(1), None), 2);
    }

    #[test]
    fn approve_pays_and_counts_toward_today() {
        let mut contract = setup();
        let id = contract.request(account("outside.near"), U128(30 * NEAR), None);
        contract.approve(id);
        assert_eq!(contract.rules().spent.0, 30 * NEAR);
        assert!(contract.requests().is_empty());
    }

    #[test]
    fn reject_drops_the_request() {
        let mut contract = setup();
        let id = contract.request(account("outside.near"), U128(NEAR), None);
        contract.reject(id);
        assert!(contract.requests().is_empty());
        assert_eq!(contract.rules().spent.0, 0);
    }

    #[test]
    #[should_panic(expected = "No such request")]
    fn approve_refuses_an_unknown_request() {
        let mut contract = setup();
        contract.approve(7);
    }

    #[test]
    #[should_panic(expected = "No such request")]
    fn a_request_cannot_be_approved_twice() {
        let mut contract = setup();
        let id = contract.request(account("outside.near"), U128(NEAR), None);
        contract.approve(id);
        contract.approve(id);
    }

    #[test]
    #[should_panic(expected = "Spending is locked")]
    fn approve_stops_when_the_desk_is_locked() {
        let mut contract = setup();
        let id = contract.request(account("outside.near"), U128(NEAR), None);
        contract.set_rules(U128(20 * NEAR), U128(50 * NEAR), false, vec![account(PAYEE)]);
        contract.approve(id);
    }

    #[test]
    #[should_panic(expected = "Only the owner")]
    fn non_owner_cannot_request() {
        let mut contract = setup();
        context("attacker.near", START_MS);
        contract.request(account("attacker.near"), U128(NEAR), None);
    }

    #[test]
    #[should_panic(expected = "Only the owner")]
    fn non_owner_cannot_approve() {
        let mut contract = setup();
        let id = contract.request(account("outside.near"), U128(NEAR), None);
        context("attacker.near", START_MS);
        contract.approve(id);
    }

    #[test]
    #[should_panic(expected = "Amount is empty")]
    fn request_refuses_an_empty_amount() {
        let mut contract = setup();
        contract.request(account("outside.near"), U128(0), None);
    }

    #[test]
    #[should_panic(expected = "Note is too long")]
    fn request_refuses_a_long_note() {
        let mut contract = setup();
        contract.request(account("outside.near"), U128(NEAR), Some("x".repeat(MAX_NOTE + 1)));
    }

    #[test]
    #[should_panic(expected = "Too many requests waiting")]
    fn requests_are_capped() {
        let mut contract = setup();
        for _ in 0..MAX_WAITING {
            contract.request(account("outside.near"), U128(NEAR), None);
        }
        contract.request(account("outside.near"), U128(NEAR), None);
    }

    #[test]
    fn a_failed_transfer_is_not_counted() {
        let mut contract = setup();
        contract.pay(account(PAYEE), U128(5 * NEAR));
        assert_eq!(contract.rules().spent.0, 5 * NEAR);
        context_self(START_MS);
        let paid = contract.on_transfer(U128(5 * NEAR), START_MS / DAY_MS, Err(PromiseError::Failed));
        assert!(!paid);
        assert_eq!(contract.rules().spent.0, 0);
    }

    #[test]
    fn a_successful_transfer_stays_counted() {
        let mut contract = setup();
        contract.pay(account(PAYEE), U128(5 * NEAR));
        context_self(START_MS);
        assert!(contract.on_transfer(U128(5 * NEAR), START_MS / DAY_MS, Ok(())));
        assert_eq!(contract.rules().spent.0, 5 * NEAR);
    }

    #[test]
    fn a_failure_from_yesterday_leaves_today_alone() {
        let mut contract = setup();
        contract.pay(account(PAYEE), U128(5 * NEAR));
        context(OWNER, START_MS + DAY_MS);
        contract.pay(account(PAYEE), U128(2 * NEAR));
        context_self(START_MS + DAY_MS);
        contract.on_transfer(U128(5 * NEAR), START_MS / DAY_MS, Err(PromiseError::Failed));
        assert_eq!(contract.rules().spent.0, 2 * NEAR);
    }

    #[test]
    #[should_panic(expected = "Only the rules account can migrate")]
    fn only_the_rules_account_can_migrate() {
        let context = VMContextBuilder::new()
            .current_account_id(account(RULES))
            .predecessor_account_id(account(OWNER))
            .build();
        testing_env!(context);
        Kyrona::migrate();
    }

    #[test]
    fn migrate_keeps_the_first_version_rules() {
        context_self(START_MS);
        env::state_write(&KyronaV1 {
            owner: account(OWNER),
            max_per_payment: 20 * NEAR,
            daily_cap: 50 * NEAR,
            open: true,
            spent: 3 * NEAR,
            day: START_MS / DAY_MS,
            allowed: vec![account(PAYEE), account(VENDOR)],
        });
        let contract = Kyrona::migrate();
        let rules = contract.rules();
        assert_eq!(rules.owner, account(OWNER));
        assert_eq!(rules.max_per_payment.0, 20 * NEAR);
        assert_eq!(rules.daily_cap.0, 50 * NEAR);
        assert!(rules.open);
        assert_eq!(rules.spent.0, 3 * NEAR);
        assert_eq!(rules.allowed, vec![account(PAYEE), account(VENDOR)]);
        assert_eq!(rules.waiting, 0);
    }
}
