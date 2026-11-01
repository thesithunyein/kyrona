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
