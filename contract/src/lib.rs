use near_sdk::json_types::U128;
use near_sdk::{env, near, require, AccountId, NearToken, Promise};

/// Spending rules that live on the account.
/// A key that can only call `pay` cannot transfer NEAR, add a key, or deploy code.
/// `pay` itself refuses an unknown account, a locked desk, or an amount over the cap.
#[near(contract_state)]
pub struct Kyrona {
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
        let day = env::block_timestamp_ms() / 86_400_000;
        if day != self.day {
            self.day = day;
            self.spent = 0;
        }
        require!(self.spent + amount <= self.daily_cap, "Over the daily cap");
        self.spent += amount;
        Promise::new(to).transfer(NearToken::from_yoctonear(amount))
    }

    pub fn rules(&self) -> RuleView {
        RuleView {
            owner: self.owner.clone(),
            max_per_payment: self.max_per_payment.into(),
            daily_cap: self.daily_cap.into(),
            open: self.open,
            spent: self.spent.into(),
            allowed: self.allowed.clone(),
        }
    }
}

impl Kyrona {
    fn only_owner(&self) {
        require!(env::predecessor_account_id() == self.owner, "Only the owner");
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
}
